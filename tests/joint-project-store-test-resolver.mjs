const modules = {
  "../db": `
    export const getD1 = () => globalThis.__jointProjectTestDb;
    export const isPostgresDatabase = () => true;
  `,
  "./collaboration":
    "export const ensureCollaborationReady = async () => undefined;",
  "./institution-names": `
    export const INSTITUTION_ALIASES_SETTING_KEY = "institution_aliases";
    export const institutionIdentityKey = (value) => String(value ?? "").trim();
  `,
};

export async function resolve(specifier, context, nextResolve) {
  if (
    context.parentURL?.endsWith("/lib/joint-projects.ts") &&
    Object.hasOwn(modules, specifier)
  ) {
    return {
      url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
