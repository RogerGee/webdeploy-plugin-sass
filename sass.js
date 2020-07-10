// sass.js - webdeploy sass plugin

const pathModule = require('path').posix;
const nodeSass = require('node-sass');

const SCSS_REGEX = /\.scss$/;

function stripLeading(string,match) {
    while (string.substring(0,match.length) == match) {
        string = string.substring(match.length);
    }
    return string;
}

function resolveModulePath(path,currentPath) {
    // Remove trailing extension component.
    var match = path.match(/\.[^./]+$/);
    if (match) {
        path = path.substr(0,path.length - match[0].length);
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
            var newPath = pathModule.join(currentPath,path.substring(1));

            return resolveModulePath(newPath,currentPath);
        }
    }

    // Strip off leading path separator components.
    return stripLeading(path,pathModule.sep);
}

function makeCustomImporter(targets,moduleBase) {
    var targetMap = {};

    for (var i = 0;i < targets.length;++i) {
        // Make the module path relative to the configured moduleBase.
        var targetPath = targets[i].getSourceTargetPath();
        var modulePath = targetPath;
        if (moduleBase) {
            modulePath = stripLeading(modulePath,pathModule.sep);
            modulePath = stripLeading(modulePath,moduleBase);
            modulePath = stripLeading(modulePath,pathModule.sep);
        }

        // Remove trailing extension.
        modulePath = modulePath.substr(0,modulePath.length-5);

        targetMap[modulePath] = targets[i];
    }

    return (url,prev,done) => {
        if (moduleBase) {
            prev = stripLeading(prev,pathModule.sep);
            prev = stripLeading(prev,moduleBase);
            prev = stripLeading(prev,pathModule.sep);
        }
        prev = pathModule.parse(prev).dir;

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
        settings.moduleBase = stripLeading(settings.moduleBase || "",'/');

        var scss = [];

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
                    let targetPath = target.getSourceTargetPath();

                    nodeSass.render({
                        // NOTE: We make all files relative to root directory to
                        // prevent resolution by libsass.
                        file: '/' + targetPath,
                        data: target.getContent(),
                        includePaths: [target.getSourcePath()],
                        indentedSyntax: false,
                        importer: importFunc

                    }, (err, result) => {
                        if (err) {
                            console.log(err);
                            reject(err);
                        }
                        else {
                            // Only include the build product if it resolved to actual content.
                            if (result.css.length > 0) {
                                var newTarget = context.resolveTargets(targetPath,[target]);
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
