import { z } from 'zod'

/** Zod defaults inside partial objects still run; PATCH must only write supplied keys. */
export function suppliedPatchFields<T extends z.ZodType>(schema: T) {
  return z.unknown().transform((input, context): z.output<T> => {
    const result = schema.safeParse(input)
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue({ ...issue })
      return z.NEVER
    }
    return Object.fromEntries(Object.entries(result.data as Record<string, unknown>)
      .filter(([key]) => Object.hasOwn(input as object, key))) as z.output<T>
  })
}
