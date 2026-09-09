/**
 * Curated marketplace catalog — bundled artifact content.
 *
 * The two integrated sources the page renders (the official MCP servers
 * reference set, and the curated agent-skills set) read verbatim from this
 * table. The Host persists deployment choices; the catalog itself never
 * changes at runtime.
 *
 * @module catalog
 */

import type { IntegrationId } from './types.ts'

/** One curated marketplace item (an MCP server or a deployable skill). */
export interface CatalogItem {
  /** Opaque marketplace id, stable across releases. */
  readonly id: IntegrationId
  /** Which marketplace kind the item ships from. */
  readonly kind: 'mcp' | 'skill'
  /** Display name. */
  readonly name: string
  /** Publisher label. */
  readonly publisher: string
  /** One-sentence description. */
  readonly description: string
  /** Optional routing hint from the source registry. */
  readonly whenToUse?: string
  /** Category chip. */
  readonly category: string
  /** Tags. */
  readonly tags: readonly string[]
  /** Documentation URL. */
  readonly docsUrl?: string
  /** Transport for MCP items. */
  readonly transport?: 'stdio' | 'http'
  /** Spawn profile for stdio servers. */
  readonly command?: string
  /** Endpoint URL for streamable-HTTP servers. */
  readonly url?: string
  /** Instruction body for skill items. */
  readonly content?: string
}

/** One integrated marketplace source. */
export interface CatalogSource {
  /** Stable source id. */
  readonly id: string
  /** Display label. */
  readonly label: string
  /** One-sentence description. */
  readonly description: string
  /** Registry homepage. */
  readonly homepage: string
}

export const MARKETPLACE_SOURCES: readonly CatalogSource[] = [
  {
    id: 'mcp-registry-official',
    label: 'Official MCP Servers',
    description: 'Reference servers from the modelcontextprotocol/servers repository.',
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'skill-registry-anthropics',
    label: 'anthropics/skills',
    description: 'Curated agent skills from the public anthropics/skills repository.',
    homepage: 'https://github.com/anthropics/skills',
  },
]

function mcp(
  id: string,
  name: string,
  publisher: string,
  category: string,
  tags: readonly string[],
  docsUrl: string,
  description: string,
  extra: { transport: 'stdio'; command: string } | { transport: 'http'; url: string },
): CatalogItem {
  return {
    id,
    kind: 'mcp',
    name,
    publisher,
    description,
    category,
    tags,
    docsUrl,
    transport: extra.transport,
    ...('command' in extra ? { command: extra.command } : {}),
    ...('url' in extra ? { url: extra.url } : {}),
  }
}

function skill(
  id: string,
  name: string,
  publisher: string,
  category: string,
  tags: readonly string[],
  docsUrl: string,
  whenToUse: string,
  description: string,
  content: string,
): CatalogItem {
  return {
    id,
    kind: 'skill',
    name,
    publisher,
    description,
    whenToUse,
    category,
    tags,
    docsUrl,
    content,
  }
}

export const MARKETPLACE_CATALOG: readonly CatalogItem[] = [
  mcp('mcp-filesystem', 'Filesystem', 'modelcontextprotocol (official)', 'files', ['files', 'read', 'write', 'search'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem', 'Read, write, create, move, and search files and directories inside an explicitly approved set of roots.', { transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-filesystem <approved-dir>...' }),
  mcp('mcp-git', 'Git', 'modelcontextprotocol (official)', 'devtools', ['git', 'vcs', 'diff', 'commit'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/git', 'Inspect repositories and drive git operations: status, diffs, log, branches, and commits.', { transport: 'stdio', command: 'uvx mcp-server-git --repository <path>' }),
  mcp('mcp-github', 'GitHub', 'modelcontextprotocol (official)', 'devtools', ['github', 'issues', 'pull-requests', 'repos'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/github', 'Work with GitHub repositories, files, issues, and pull requests through the GitHub API.', { transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-github' }),
  mcp('mcp-memory', 'Memory', 'modelcontextprotocol (official)', 'memory', ['knowledge-graph', 'persistence', 'entities'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory', 'Persistent entity-relation memory graph so facts survive across conversation turns and sessions.', { transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-memory' }),
  mcp('mcp-sequential-thinking', 'Sequential Thinking', 'modelcontextprotocol (official)', 'reasoning', ['planning', 'reasoning', 'reflection'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking', 'Structured step-by-step reasoning tool: revise and branch thoughts on hard, multi-stage problems.', { transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-sequential-thinking' }),
  mcp('mcp-fetch', 'Fetch', 'modelcontextprotocol (official)', 'web', ['http', 'url', 'markdown'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch', 'Fetch a URL and return its content converted to markdown for the model to read.', { transport: 'stdio', command: 'uvx mcp-server-fetch' }),
  mcp('mcp-sqlite', 'SQLite', 'modelcontextprotocol (official)', 'data', ['sql', 'database', 'sqlite'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite', 'Schema inspection and read/write SQL against a local SQLite database file.', { transport: 'stdio', command: 'uvx mcp-server-sqlite --db-path <path>' }),
  mcp('mcp-postgres', 'PostgreSQL', 'modelcontextprotocol (official)', 'data', ['sql', 'postgres', 'database'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres', 'Read-only schema browsing and querying of a PostgreSQL database.', { transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-postgres <connection-url>' }),
  mcp('mcp-puppeteer', 'Puppeteer', 'modelcontextprotocol (official)', 'browser', ['browser', 'automation', 'screenshots'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer', 'Drive a headless browser: navigate, click, fill forms, and capture screenshots.', { transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-puppeteer' }),
  mcp('mcp-playwright', 'Playwright', 'microsoft', 'browser', ['browser', 'testing', 'automation'], 'https://github.com/microsoft/playwright-mcp', 'Browser automation and end-to-end web testing built on Playwright accessibility snapshots.', { transport: 'stdio', command: 'npx -y @playwright/mcp@latest' }),
  mcp('mcp-brave-search', 'Brave Search', 'modelcontextprotocol (official)', 'search', ['search', 'web', 'news', 'images'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search', 'Web and local search via the Brave Search API (requires an API key).', { transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-brave-search' }),
  mcp('mcp-slack', 'Slack', 'modelcontextprotocol (official)', 'communication', ['slack', 'channels', 'messages'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack', 'List channels, read history, and post messages in a Slack workspace.', { transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-slack' }),
  mcp('mcp-google-drive', 'Google Drive', 'modelcontextprotocol (official)', 'files', ['drive', 'docs', 'search'], 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive', 'Search and read files from Google Drive, exporting Docs and Sheets to text.', { transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-gdrive' }),
  mcp('mcp-context7', 'Context7', 'upstash', 'docs', ['docs', 'libraries', 'up-to-date'], 'https://github.com/upstash/context7', 'Up-to-date, version-specific documentation and examples for thousands of libraries.', { transport: 'http', url: 'https://mcp.context7.com/mcp' }),
  mcp('mcp-deepwiki', 'DeepWiki', 'devdoby/deepwiki', 'docs', ['repositories', 'wiki', 'questions'], 'https://github.com/AsyncFuncAI/deepwiki-open', 'Ask questions about indexed open-source repositories and get grounded, cited answers.', { transport: 'http', url: 'https://mcp.deepwiki.com/mcp' }),
  mcp('mcp-exa', 'Exa', 'exa-labs', 'search', ['search', 'web', 'research'], 'https://github.com/exa-labs/exa-mcp-server', 'Neural web search tuned for agents: semantic queries, crawls, and related-link discovery.', { transport: 'http', url: 'https://mcp.exa.ai/mcp' }),
  mcp('mcp-notion', 'Notion', 'notionhq', 'productivity', ['notion', 'pages', 'databases'], 'https://developers.notion.com/docs/mcp', 'Search, read, and update Notion pages and databases with OAuth-secured access.', { transport: 'http', url: 'https://mcp.notion.com/mcp' }),
  mcp('mcp-sentry', 'Sentry', 'getsentry', 'devtools', ['errors', 'monitoring', 'issues'], 'https://docs.sentry.io/product/explore/mcp-server/', 'Resolve production errors: issue details, stack traces, and release health from Sentry.', { transport: 'http', url: 'https://mcp.sentry.dev/mcp' }),
  skill('skill-pdf', 'pdf', 'anthropics/skills', 'documents', ['pdf', 'forms', 'extraction'], 'https://github.com/anthropics/skills', 'When reading, creating, editing, merging, or splitting PDF files, or filling PDF forms.', 'Comprehensive PDF processing: extract text and tables, create documents, merge and split files, and fill forms.', [
    '# PDF processing', '',
    'Follow these steps for PDF work:', '',
    '1. Inspect first: run a page count and text extraction pass before any modification, and report the page count, outline, and whether the PDF is text-based or scanned.',
    '2. Text-based PDFs: extract text and tables directly. Preserve reading order and flag tables separately from prose.',
    '3. Scanned PDFs: say so explicitly, extract what OCR-level tooling allows, and never invent text that extraction did not return.',
    '4. Creating PDFs: prefer a deterministic generation path over printing HTML; name the output file, and verify page count after generation.',
    '5. Merging or splitting: state the input page ranges and the resulting page counts before writing the output.',
    '6. Forms: list the discovered field names first, then fill exactly those fields.', '',
    'Never fabricate page contents; quote or extract instead.',
  ].join('\n')),
]
