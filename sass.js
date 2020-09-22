// sass.js - webdeploy sass plugin

const pathModule = require('path').posix;
const nodeSass = require('node-sass');
const { format } = require("util");

const SCSS_REGEX = /\.scss$/;

function formatSettings(settings) {
    const { sep } = pathModule;

    settings.moduleBase = strip(settings.moduleBase || "",sep);
    settings.alias = settings.alias || null;
    if (typeof settings.alias === "object" && settings.alias) {
        const alias = {};
        Object.keys(settings.alias).forEach((key) => {
            alias[strip(key,sep)] = strip(settings.alias[key],sep);
        });
        settings.alias = alias;
    }
    else {
        settings.alias = null;
    }
    settings.replace = settings.replace || null;
    if (typeof settings.resolveRelativePaths !== 'boolean') {
        settings.resolveRelativePaths = true;
    }
    settings.rename = settings.rename || false;
    if (settings.rename === true) {
        settings.rename = ".css";
    }
    if (settings.rename && typeof settings.rename !== "string") {
        throw new Error("sass: invalid 'rename' setting");
    }
    settings.targets = settings.targets || [];
    if (!Array.isArray(settings.targets)) {
        throw new Error("sass: invalid 'targets' setting");
    }
}

function strip(string,match) {
    return stripLeading(stripTrailing(string,match),match);
}

function stripLeading(string,match) {
    while (string.substring(0,match.length) == match) {
        string = string.substring(match.length);
    }
    return string;
}

function stripTrailing(string,match) {
    let n;
    while ((n = string.length - match.length) && string.substring(n) == match) {
        string = string.substring(0,n);
    }
    return string;
}

function stripExtension(path) {
    const match = path.match(/\.[^.\/]+$/);
    if (match) {
        return path.substr(0,path.length - match[0].length);
    }
    return path;
}

function resolvePathPrefix(path,prefix,replacement) {
    const match = path.match("^"+prefix+"(/.+)$");
    if (match) {
        return replacement + match[1];
    }

    if (path == prefix) {
        return replacement;
    }

    return path;
}

function resolvePrefix(string,prefix,replacement) {
    if (string.substring(0,prefix.length) == prefix) {
        return replacement + string.substring(prefix.length);
    }
    return string;
}

function resolveModulePath(path,settings) {
    let newPath = path;
    newPath = stripLeading(newPath,pathModule.sep);
    if (settings.moduleBase) {
        newPath = resolvePathPrefix(newPath,settings.moduleBase,"");
        newPath = stripLeading(newPath,pathModule.sep);
    }
    return newPath;
}

function resolveImportPath(path,currentPath,settings) {
    const { alias, replace, resolveRelativePaths } = settings;

    // Remove trailing extension component.
    path = stripExtension(path);

    // Resolve "." or ".." recursively.
    if (resolveRelativePaths && path[0] == '.') {
        if (path[1] == '.' && path[2] == '/') {
            currentPath = pathModule.parse(currentPath).dir;
            const newPath = pathModule.join(currentPath,path.substring(2));

            return resolveImportPath(newPath,currentPath,settings);
        }

        if (path[1] == '/') {
            const newPath = pathModule.join(currentPath,path.substring(1));

            return resolveImportPath(newPath,currentPath,settings);
        }
    }

    // Perform alias resolutions.
    if (alias) {
        Object.keys(alias).forEach((prefix) => {
            path = resolvePathPrefix(path,prefix,alias[prefix]);
        });
    }

    // Perform replace resolutions.
    if (replace) {
        Object.keys(replace).forEach((prefix) => {
            path = resolvePrefix(path,prefix,replace[prefix]);
        });
    }

    // Strip off leading path separator components.
    return stripLeading(path,pathModule.sep);
}

function makeImporterFactory(graph,targets,imported,settings) {
    const targetMap = {};

    for (let i = 0;i < targets.length;++i) {
        let modulePath = resolveModulePath(targets[i].getSourceTargetPath(),settings);

        // Strip the extension so that import paths don't have to specify the
        // extension.
        modulePath = stripExtension(modulePath);

        targetMap[modulePath] = targets[i];
    }

    return function makeCustomImporter(parentTarget) {
        return (url,prev,done) => {
            // Determine current path context from previously resolved path.
            const currentPath = resolveModulePath(pathModule.parse(prev).dir,settings);
            const path = resolveImportPath(url,currentPath,settings);

            if (path in targetMap) {
                const target = targetMap[path];

                graph.addLink(parentTarget.getSourceTargetPath(),target.getSourceTargetPath());
                imported.add(target.getSourceTargetPath());

                done({ file: path, contents: target.content });
            }
            else {
                done(new Error("sass: module '" + url + "' ('" + path + "') does not exist"));
            }
        };

    };
}

function checkTargets(targets,targetPath) {
    // If no targets are provided, then we just include everything.
    if (targets.length == 0) {
        return true;
    }

    return targets.some((regex) => targetPath.match(regex));
}

function removeImportTargets(context,targets,utilized) {
    // Remove the targets marked for removal. Targets that were not utilized get
    // removed from the dependency graph.
    const used = [];
    const notused = [];
    for (let i = 0;i < targets.length;++i) {
        const target = targets[i];
        if (utilized.has(target.getSourceTargetPath())) {
            used.push(target);
        }
        else {
            notused.push(target);
        }
    }

    context.removeTargets(used,false);
    context.removeTargets(notused,true);
}

function render(options) {
    return new Promise((resolve,reject) => {
        nodeSass.render(options,(err, result) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(result);
            }
        });
    });
}

module.exports = {
    async exec(context,settings) {
        formatSettings(settings);

        const scss = [];

        // Find all .scss targets.
        context.forEachTarget((target) => {
            if (target.targetName.match(SCSS_REGEX)) {
                scss.push(target);
            }
        });

        if (scss.length == 0) {
            return;
        }

        // Ensure all target content loaded into memory. The SASS compiler will
        // need this for module resolution anyway.
        for (let i = 0;i < scss.length;++i) {
            await scss[i].loadContent();
        }

        const rm = [];
        const promises = [];
        const utilized = new Set();
        const importerFactory = makeImporterFactory(context.graph,scss,utilized,settings);

        // Invoke node-sass to compile each target.
        for (let i = 0;i < scss.length;++i) {
            const target = scss[i];
            const targetPath = target.getSourceTargetPath();
            const sourcePath = target.getSourcePath();

            // Avoid rendering targets that are not included in the build. These
            // targets are implicitly considered include-only. Note that the
            // 'isIncludeOnly' option is still supported in the target options.
            if (target.options.isIncludeOnly || !checkTargets(settings.targets,targetPath)) {
                rm.push(target);
                continue;
            }

            let result;
            try {
                const options = {
                    // NOTE: We make all files relative to root directory to
                    // prevent resolution to the CWD by libsass.
                    file: '/' + targetPath,
                    data: target.getContent(),
                    includePaths: [sourcePath],
                    indentedSyntax: false,
                    importer: importerFactory(target)
                };

                result = await render(options);

            } catch (err) {
                if ("file" in err) {
                    throw new Error(format("sass: %s in %s:%d",err.message,err.file,err.line));
                }

                throw err;
            }

            // Only include the build product if it resolved to actual content.
            if (result.css.length > 0) {
                let newTargetPath = targetPath;
                if (settings.rename) {
                    newTargetPath = target.getTargetName().replace(SCSS_REGEX,settings.rename);
                    newTargetPath = pathModule.join(sourcePath,newTargetPath);
                }

                const newTarget = context.resolveTargets(newTargetPath,[target]);
                newTarget.stream.end(result.css.toString('utf8'));
            }
            else {
                // Otherwise remove the target if it evaluated to empty.
                context.resolveTargets(null,[target]);
            }
        }

        removeImportTargets(context,rm,utilized);
    }
};
