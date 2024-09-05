import { z } from 'zod';
import { validateRequest } from '@nangohq/utils';
import type { Endpoint } from '@nangohq/types';

export const validateRecords = <E extends Endpoint<any>>() =>
    validateRequest<E>({
        parseBody: (data: unknown) =>
            z
                .object({
                    model: z.string(),
                    records: z.array(z.object({ id: z.union([z.string().max(255).min(1), z.number()]) }).catchall(z.unknown())).nonempty(),
                    providerConfigKey: z.string(),
                    connectionId: z.string(),
                    activityLogId: z.string()
                })
                .strict()
                .parse(data),
        parseParams: (data: unknown) =>
            z
                .object({
                    environmentId: z.coerce.number().int().positive(),
                    nangoConnectionId: z.coerce.number().int().positive(),
                    syncId: z.string(),
                    syncJobId: z.coerce.number().int().positive()
                })
                .strict()
                .parse(data)
    });