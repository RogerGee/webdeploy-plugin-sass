# webdeploy-plugin-sass

> Deploy plugin for compiling Sass

## Synopsis

This plugin performs a Sass compilation using `node-sass`. The plugin separates the `.scss` targets into two subsets: includes and entry points. Entry points are matched using regex patterns in the `targets` settings property. Anything that isn't matched as an entry point is considered an include and is not compiled directly.

Targets marked as includes are removed from the deployment. Only entry targets are preserved, being transformed with the compiled CSS content.

The plugin works using a custom importer in `node-sass` to virtualize the file system for the `webdeploy` subsystem.

## Install

~~~
npm install --save-dev @webdeploy/plugin-sass
~~~

## Config

### `targets`

- Type: `<string | RegExp>[]`
- Optional: yes (but more likely than not, you'll need it)

Defines a list of regex patterns used to indicate which targets are to be compiled (i.e. which targets are the entry point into the Sass compilation). Every other target (i.e. having a `.scss` extension) is considered "include-only" and will not be compiled.

**Note**: "include-only" targets can be indicated via the `includeOnly` target option. However this feature is deprecated and only maintained for backwards compatibility.

### `moduleBase`

- Type: `string`
- Optional: yes

Defines the base module path. This is a path component prefix that is used to simplify the name of a file included in the Sass build. For example, if the base module path is `src`, then target `src/alpha.scss` becomes `alpha.scss`.

### `alias`

- Type: `object` dictionary
- Optional: yes

Defines a dictionary of path aliases. A path alias is a path component prefix that is transformed into another prefix. The keys in the dictionary represent the prefixes to match, and the values in the dictionary represent the alias prefixes to apply. For example, `{ alpha: "styles/alpha" }` translates any path leading with `alpha/` to `styles/alpha/`.

**Important Note:** Aliases are applied _after_ the `moduleBase`. So any aliased path must exist under the module base if defined.

### `replace`


- Type: `object` dictionary
- Optional: yes

Defines a dictionary of simple prefix replacements to perform on a module path. This property works similarly to `alias` except it doesn't match against path components. Instead the prefixes are just simple components. This is commonly used to translate something like `~module` having no path separators.

**Important Note:** Replacements are applied _after_ the `moduleBase`.

### `resolveRelativePaths`

- Type: `boolean`
- Default: `true`

Determines how `.` and `..` are resolved. If enabled, then relative paths are recursively resolved such that all resolution options are applied recursively (e.g. `alias`). If this option is disabled, then the paths are kept as-is.

### `rename`

- Type: `boolean` or `string`
- Optional: yes

Indicates whether compiled Sass targets should be renamed. By default, the plugin does _not_ rename targets. Setting this option to `true` will rename targets with a `.css` extension. You may pass a custom string to denote the extension in case you need something else. This property needs to include the leading `.`; it is a direct replacement for the `.scss` suffix.


### Example:

~~~javascript
{
  id: "sass",
  targets: [ /* ... */ ],
  moduleBase: "",
  alias: { /* ... */ },
  replace: { /* ... */ },
  resolveRelativePaths: true,
  rename: false
}
~~~

