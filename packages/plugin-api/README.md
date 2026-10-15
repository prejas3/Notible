# `@notible/plugin-api`

Public, dependency-free TypeScript contract for Notible plugins.

The package intentionally contains only manifests, lifecycle context and
registration and data-contract types. It must not import Tauri, React, SQLite or
private Core components. The package is still `0.x`; plugins must declare the `apiVersion`
they were tested against and should not assume `v1` compatibility yet.

During local development, import the source entrypoint:

```ts
import type { NotiblePlugin } from "@notible/plugin-api";
```

The Core host remains responsible for validation, permissions, loading and
cleanup. A valid manifest and TypeScript types do not make untrusted code
sandboxed. UI registrations require `workspace.ui`; data operations require
their corresponding `data.*` or `relations.write` permission.

The public `DataApi` includes objects, relations, types and reusable data
sources. A plugin must use these operations rather than importing Core SQLite
or private frontend modules directly.

Permissions are declared in `manifest.permissions` (`data.read`,
`data.write`, `workspace.ui`, `network`, and others). The declaration is part
of the review/install contract. The local host validates the names, exposes
`context.permissions.has/require`, scopes the current `DataApi` operations and
guards UI registrations. Filesystem and network APIs are intentionally not
exposed by the trusted local runtime yet; declaring those permissions does not
create a sandbox or grant direct access to host resources.
