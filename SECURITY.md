# Security boundaries

Contact the repository maintainer privately about suspected vulnerabilities. Avoid posting sensitive data or working exploits in public issues.

Grid permissions control library operations. They are not server authorization and cannot protect data already sent to a browser. Enforce authentication, row/field authorization and validation on the server; supply only data the current user may read. Hosts must not expose unrestricted data sources or trusted callbacks to untrusted scripts.

Canvas converts rich text to a restricted text/style model before rendering. It does not mount supplied HTML elements, attributes, scripts or images from rich HTML. Markdown parsing is optional; its HTML output is not a general-purpose sanitizer and must not be inserted directly into a page. Custom renderers, editors, parsers and metadata/upload callbacks are trusted host code.

Web links accept HTTP(S), reject embedded credentials and open with opener/referrer protection. Media columns intentionally load supplied image URLs; loading an external image discloses a network request to its host. Canvas images and details use anonymous cross-origin mode and no referrer. Hosts needing stricter privacy must validate image origins and enforce an appropriate CSP; browser image decoding, uploaded file inspection and durable storage policy remain host responsibilities.

Clipboard/template/import budgets bound supported operations, not total application resource use. Remote/live sources have bounded queues and generation guards; hosts own transport, cancellation cooperation, authentication and reconnect/save conflict semantics. MCP grid access requires explicit host authorization; writes additionally require opt-in and synchronous host validation. Its documentation CLI does not expose a dataset automatically.

CSV escapes formula-like text by default, including controls and full-width operators; explicit preserve mode disables that protection. Spreadsheet applications can reinterpret CSV after editing or re-saving. XLSX text uses inline strings without formulas or hyperlinks. Do not treat CSV escaping as a guarantee across all spreadsheet applications.

Dependency advisory scans and regression tests cover known cases at a point in time. They cannot establish that every possible vulnerability is absent. Review host integration, deployment policy, dependency updates and untrusted data flows before production use.
