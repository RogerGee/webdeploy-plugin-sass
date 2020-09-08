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
        var alias = {};
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
    settings.rename = settings.rename || null;
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

function makeCustomImporter(targets,settings) {
    const targetMap = {};

    for (let i = 0;i < targets.length;++i) {
        let modulePath = resolveModulePath(targets[i].getSourceTargetPath(),settings);

        // Strip the extension so that import paths don't have to specify the
        // extension.
        modulePath = stripExtension(modulePath);

        targetMap[modulePath] = targets[i];
    }

    return (url,prev,done) => {
        // Determine current path context from previously resolved path.
        const currentPath = resolveModulePath(pathModule.parse(prev).dir,settings);
        const path = resolveImportPath(url,currentPath,settings);

        if (path in targetMap) {
            done({ file: path, contents: targetMap[path].content });
        }
        else {
            done(new Error("sass: module '" + url + "' ('" + path + "') does not exist"));
        }
    };
}

function checkTargets(targets,targetPath) {
    // If no targets are provided, then we just include everything.
    if (targets.length == 0) {
        return true;
    }

    return targets.some((regex) => targetPath.match(regex));
}

module.exports = {
    exec: (context,settings) => {
        formatSettings(settings);

        const scss = [];

        // Find all .scss targets.
        context.forEachTarget((target) => {
            if (target.targetName.match(SCSS_REGEX)) {
                scss.push(target);
            }
        });

        if (scss.length == 0) {
            return Promise.resolve();
        }

        // Load all content into memory. The SASS compiler will need this for
        // module resolution anyway.
        const promises = [];
        for (var i = 0;i < scss.length;++i) {
            promises.push(scss[i].loadContent());
        }

        return Promise.all(promises).then(() => {
            const rm = [];
            const promises = [];
            const importFunc = makeCustomImporter(scss,settings);

            // Call node-sass to compile each target.
            for (var i = 0;i < scss.length;++i) {
                const target = scss[i];
                const targetPath = target.getSourceTargetPath();
                const sourcePath = target.getSourcePath();

                // Avoid rendering targets that are not included in the
                // build. These targets are implicitly considered
                // include-only. Note that the 'isIncludeOnly' option is still
                // supported in the target options.
                if (target.options.isIncludeOnly || !checkTargets(settings.targets,targetPath)) {
                    rm.push(target);
                    continue;
                }

                const renderPromise = new Promise((resolve,reject) => {

                    nodeSass.render({
                        // NOTE: We make all files relative to root directory to
                        // prevent resolution by libsass.
                        file: '/' + targetPath,
                        data: target.getContent(),
                        includePaths: [sourcePath],
                        indentedSyntax: false,
                        importer: importFunc

                    }, (err, result) => {
                        if (err) {
                            if ("file" in err) {
                                const msg = format("sass: %s in %s:%d",err.message,err.file,err.line);
                                reject(new Error(msg));
                            }
                            else {
                                reject(err);
                            }
                        }
                        else {
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

                            resolve();
                        }
                    });
                });

                promises.push(renderPromise);
            }

            // Remove any removed targets.
            context.resolveTargets(null,rm);

            return Promise.all(promises);
        });
    }
}
