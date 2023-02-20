/*
 * Copyright (c) 2022 Nango, all rights reserved.
 */

const cloudHost = 'https://api.nango.dev';
const debugLogPrefix = 'NANGO DEBUG LOG: ';

export default class Nango {
    private hostBaseUrl: string;
    private status: AuthorizationStatus;
    private publicKey: string | undefined;
    private debug: boolean = false;

    constructor(config: { host?: string; publicKey?: string; debug?: boolean } = {}) {
        config.host = config.host || cloudHost;
        this.debug = config.debug || false;

        if (this.debug) {
            console.log(debugLogPrefix, 'Debug mode is enabled.');
        }

        if (config.host === cloudHost && !config.publicKey) {
            throw new Error('You should specify a Public Key when using Nango Cloud (cf. documentation).');
        }

        this.hostBaseUrl = config.host;
        this.hostBaseUrl = config.host.slice(-1) === '/' ? config.host.slice(0, -1) : config.host;
        this.status = AuthorizationStatus.IDLE;
        this.publicKey = config.publicKey;

        try {
            new URL(this.hostBaseUrl);
        } catch (err) {
            throw new Error(`Invalid URL provided for the Nango host: ${this.hostBaseUrl}`);
        }

        if (!window) {
            const errorMessage = "Couldn't initialize Nango frontend. The window object is undefined. Are you using Nango frontend from a browser?";
            throw new Error(errorMessage);
        }
    }

    public auth(providerConfigKey: string, connectionId: string, connectionConfig?: ConnectionConfig): Promise<any> {
        const url = this.hostBaseUrl + `/oauth/connect/${providerConfigKey}${this.toQueryString(connectionId, connectionConfig)}`;

        try {
            new URL(url);
        } catch (err) {
            throw new Error(`Could not construct valid Nango URL based on provided parameters: ${url}`);
        }

        return new Promise((resolve, reject) => {
            const handler = (e?: MessageEvent) => {
                if (this.status !== AuthorizationStatus.BUSY) {
                    return;
                }

                // All sorts of extensions and pages might send messages so we need to filter the relevant ones.
                // Nango messages will always have the data.eventType attribute set.
                if (e && !e.data.eventType) {
                    return;
                }

                this.status = AuthorizationStatus.DONE;

                if (!e) {
                    const error = {
                        type: 'authorization_cancelled',
                        message: 'Authorization cancelled. The user has likely interrupted the process by closing the modal.'
                    };
                    return reject(error);
                }

                const { data: event } = e;

                if (event.eventType === 'AUTHORIZATION_SUCEEDED') {
                    return resolve(event.data);
                } else if (event.eventType === 'AUTHORIZATION_FAILED') {
                    return reject(event.data);
                }

                reject(new Error('Authorization failed. That’s all we know.'));
            };

            // Add an event listener on authorization modal
            //
            // Note: this adds one event listener for each authorization process.
            // In an application doing lots of connect, this can cause a memory issue.
            window.addEventListener('message', handler, false);

            // Save authorization status (for handler)
            this.status = AuthorizationStatus.BUSY;

            // Open authorization modal
            const modal = new AuthorizationModal(url, this.debug);
            modal.open();
            modal.addEventListener('close', handler);
        });
    }

    toQueryString(connectionId: string, connectionConfig?: ConnectionConfig): string {
        let query: string[] = [];

        if (connectionId) {
            query.push(`connection_id=${connectionId}`);
        }

        if (this.publicKey) {
            query.push(`public_key=${this.publicKey}`);
        }

        if (connectionConfig != null) {
            for (const param in connectionConfig.params) {
                const val = connectionConfig.params[param];
                if (typeof val === 'string') {
                    query.push(`params[${param}]=${val}`);
                }
            }
        }

        return query.length === 0 ? '' : '?' + query.join('&');
    }
}

interface ConnectionConfig {
    params: Record<string, string>;
}

enum AuthorizationStatus {
    IDLE,
    BUSY,
    DONE
}

/**
 * AuthorizationModal class
 */
class AuthorizationModal {
    private url: string;
    private features: { [key: string]: string | number };
    private width = 500;
    private height = 600;
    private modal!: Window | null;
    private debug: boolean = false;

    constructor(url: string, debug?: boolean) {
        this.debug = debug || false;

        // Window modal URL
        this.url = url;

        const { left, top, computedWidth, computedHeight } = this.layout(this.width, this.height);

        // Window modal features
        this.features = {
            width: computedWidth,
            height: computedHeight,
            top,
            left,
            scrollbars: 'yes',
            resizable: 'yes',
            noopener: 'no',
            // Using "noopener=yes" would be safer but we needa access to the 'closed' property on the modal.
            status: 'no',
            toolbar: 'no',
            location: 'no',
            copyhistory: 'no',
            menubar: 'no',
            directories: 'no'
        };
    }

    /**
     * The modal is expected to be in the center of the screen.
     */
    layout(expectedWidth: number, expectedHeight: number) {
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        const left = screenWidth / 2 - expectedWidth / 2;
        const top = screenHeight / 2 - expectedHeight / 2;

        const computedWidth = Math.min(expectedWidth, screenWidth);
        const computedHeight = Math.min(expectedHeight, screenHeight);

        return { left: Math.max(left, 0), top: Math.max(top, 0), computedWidth, computedHeight };
    }

    /**
     * Open the modal
     */

    open() {
        const url = this.url;
        const windowName = '';
        const windowFeatures = this.featuresToString();
        this.modal = window.open(url, windowName, windowFeatures);
        console.log(debugLogPrefix, `Modal opened. Modal exists? ${this.modal != null}`);
        return this.modal;
    }

    /**
     * Add event listener on the modal
     */

    addEventListener(eventType: string, handler: (e: any) => any): void {
        if (this.debug) {
            console.log(debugLogPrefix, `Adding 'close' event listener on modal: 1st step.`);
        }

        if (eventType !== 'close') {
            return;
        }

        if (this.debug) {
            console.log(debugLogPrefix, `Adding 'close' event listener on modal: 2nd step.`);
        }

        if (!this.modal) {
            handler(undefined);
            return;
        }

        if (this.debug) {
            console.log(debugLogPrefix, `Adding 'close' event listener on modal: 3rd step.`);
        }

        const interval = window.setInterval(() => {
            if (this.debug) {
                console.log(debugLogPrefix, `Polling modal status. Exists? ${this.modal != null}, closed? ${this.modal?.closed}`);
            }

            if (!this.modal || this.modal.closed) {
                if (this.debug) {
                    console.log(debugLogPrefix, `Modal closed.`);
                }

                let e = {
                    data: {
                        eventType: 'AUTHORIZATION_FAILED',
                        data: {
                            type: 'authorization_cancelled',
                            message: 'The user has closed the authorization modal before the process was complete.'
                        }
                    }
                };
                handler(e);
                window.clearInterval(interval);
            }
        }, 100);
    }

    /**
     * Helper to convert the features object of this class
     * to the comma-separated list of window features required
     * by the window.open() function.
     */
    featuresToString(): string {
        const features = this.features;
        const featuresAsString: string[] = [];

        for (let key in features) {
            featuresAsString.push(key + '=' + features[key]);
        }

        return featuresAsString.join(',');
    }
}
