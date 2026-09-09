/**
 * Integrations settings surface, node half. The empty apply exists so the
 * plugin appears in the host cordis.yml / Loader; the browser half owns the
 * section through `exports["./client"]`, discovered from the package.json
 * `dsh.client` declaration. The durable `integrations-studio` settings
 * namespace is owned by the Host plugin `@deepseek-ai/dsh-integrations-studio`;
 * this package registers no namespace of its own.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
