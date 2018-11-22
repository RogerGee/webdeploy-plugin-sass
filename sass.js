// sass.js - webdeploy sass plugin

const pathModule = require('path').posix;
const nodeSass = require('node-sass');

const SCSS_REGEX = /\.scss$/;

function resolveModulePath(path,currentPath) {
    // Remove trailing extension component.
    var match = path.match(/\.[^./]+$/);
    if (match) {
        path = path.substr(0,path.length - match[0].length);
    }

    // Substitute '~' with base path. This is as simple as just removing the
    // '~'.
    if (path[0] == '~') {
        return resolveModulePath(path.substr(1),currentPath);
    }

    // Resolve "." or ".." recursively.
    if (path[0] == '.') {
        if (path[1] == '.' && path[2] == '/') {
            var newPath;
            currentPath = pathModule.parse(currentPath).dir;
            newPath = pathModule.join(currentPath,path.substring(2));

            return resolveModulePath(newPath,currentPath);
        }

        if (path[1] == '/') {
            var newPath = pathModule.join(currentPath,path.substring(1))

            return resolveModulePath(newPath,currentPath);
        }
    }

    // Strip off leading path separator components.
    var pos = 0;
    while (pos < path.length && path[pos] == '/') {
        pos += 1;
    }

    return path.substr(pos);
}

function makeCustomImporter(targets,moduleBase) {
    var targetMap = {};

    function targetPathToModulePath(targetPath) {
        if (targetPath.substr(0,moduleBase.length) == moduleBase) {
            var offset = moduleBase.length;
            while (offset < targetPath.length && targetPath[offset] == '/') {
                offset += 1;
            }

            var modulePath = targetPath.substr(offset);
        }
        else {
            var modulePath = targetPath;
        }

        return modulePath;
    }

    for (var i = 0;i < targets.length;++i) {
        // Make the module path relative to the configured moduleBase.
        var targetPath = targets[i].getSourceTargetPath();
        var modulePath = targetPathToModulePath(targetPath);

        // Remove trailing extension.
        modulePath = modulePath.substr(0,modulePath.length-5);

        targetMap[modulePath] = targets[i];
    }

    return (url,prev,done) => {
        if (prev[0] == '/') {
            prev = targetPathToModulePath(prev.substr(1));
        }
        else {
            prev = pathModule.parse(prev).dir;
        }

        var path = resolveModulePath(url,prev);
        if (path in targetMap) {
            done({ file: path, contents: targetMap[path].content });
        }
        else {
            done(new Error("Module '" + url + "' ('" + path + "') does not exist"));
        }
    };
}

module.exports = {
    exec: (context,settings) => {
        settings.moduleBase = settings.moduleBase || "";

        var scss = [];

        // Find all .scss targets.
        for (var i = 0;i < context.targets.length;++i) {
            var target = context.targets[i];

            if (target.targetName.match(SCSS_REGEX)) {
                scss.push(target);
            }
        }

        if (scss.length == 0) {
            return Promise.resolve();
        }

        // Load all content into memory. The SASS compiler will need this for
        // module resolution anyway.
        var promises = [];
        for (var i = 0;i < scss.length;++i) {
            promises.push(scss[i].loadContent());
        }

        return Promise.all(promises).then(() => {
            var rm = [];
            var promises = [];
            var importFunc = makeCustomImporter(scss,settings.moduleBase);

            // Call node-sass on each target, saving the compilation into a new
            // target with ".css" suffix.
            for (var i = 0;i < scss.length;++i) {
                let target = scss[i];

                // Avoid rendering include-only targets.
                if (target.options.isIncludeOnly) {
                    rm.push(target);
                    continue;
                }

                var renderPromise = new Promise((resolve,reject) => {
                    nodeSass.render({
                        file: '/' + target.sourcePath,
                        data: target.content,
                        includePaths: [target.sourcePath],
                        indentedSyntax: false,
                        importer: importFunc
                    }, (err, result) => {
                        if (err) {
                            console.log(target.getSourceTargetPath());
                            reject(err);
                        }
                        else {
                            // Only include the build product if it resolved to actual content.
                            if (result.css.length > 0) {
                                var match = target.targetName.match(/(.*)\.scss$/);
                                var newPath = pathModule.join(target.sourcePath,match[1] + ".css");
                                var newTarget = context.resolveTargets(newPath,[target]);
                                newTarget.stream.end(result.css.toString('utf8'));
                            }
                            else {
                                // Remove targets that evaluated to empty.
                                context.resolveTargets(null,[target]);
                            }

                            resolve();
                        }
                    })
                })

                promises.push(renderPromise);
            }

            // Remove any removed targets.
            context.resolveTargets(null,rm);

            return Promise.all(promises);
        })
    }
}
