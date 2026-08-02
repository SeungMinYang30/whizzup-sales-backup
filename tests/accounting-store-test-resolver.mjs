const modules = {
  "../db": "export const getD1 = () => { throw new Error('test stub'); };",
  "./equipment-store":
    "export const ensureEquipmentReady = async () => undefined;",
  "./records-store":
    "export const ensureRecordsReady = async () => undefined;",
};

export async function resolve(specifier, context, nextResolve) {
  if (
    context.parentURL?.endsWith("/lib/accounting-store.ts") &&
    Object.hasOwn(modules, specifier)
  ) {
    return {
      url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
