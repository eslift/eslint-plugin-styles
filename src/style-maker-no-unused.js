const hookRegEx = /^use[A-Z]/;

function getMakerNames(settings) {
  return settings['react-native/style-maker-names'] || ['makeStyles'];
}

function getHookNameForDecl(decl) {
  if (
    decl &&
    decl.type === 'VariableDeclarator' &&
    decl.id &&
    decl.id.type === 'Identifier' &&
    decl.init &&
    decl.init.type === 'CallExpression' &&
    decl.init.callee.type === 'Identifier'
  ) {
    let hookName = decl.init.callee.name || '';
    if (hookRegEx.test(hookName)) {
      return hookName;
    }
  }
}

function getDeclForName(name, scope) {
  while (scope) {
    let variable = scope.set.get(name);
    if (variable && variable.defs && variable.defs.length === 1) {
      let def = variable.defs[0];
      return { scope, node: def.node };
    }
    scope = scope.upper;
  }
}

function isStyleMaker(node, context) {
  let makerNames = getMakerNames(context.settings);
  return Boolean(
    node &&
      node.type === 'CallExpression' &&
      node.callee &&
      node.callee.type === 'Identifier' &&
      node.callee.name &&
      makerNames.includes(node.callee.name),
  );
}

function getHookNameForMaker(node) {
  if (
    node &&
    node.parent &&
    node.parent.type === 'VariableDeclarator' &&
    node.parent.id &&
    node.parent.id.type === 'Identifier'
  ) {
    return node.parent.id.name;
  }
}

function getStyleProperties(node) {
  let styles = new Map();
  if (
    node &&
    node.type === 'CallExpression' &&
    node.arguments &&
    node.arguments[0]
  ) {
    let firstArg = node.arguments[0];
    let object =
      firstArg.type === 'ArrowFunctionExpression'
        ? getReturnObject(firstArg)
        : firstArg.type === 'ObjectExpression'
        ? firstArg
        : null;
    if (object) {
      for (let property of object.properties) {
        if (
          property.type === 'Property' &&
          property.computed === false &&
          property.key.type === 'Identifier'
        ) {
          styles.set(property.key.name, property);
        }
      }
    }
  }
  return styles;
}

function getReturnObject(node) {
  if (node.body && node.body.type === 'ObjectExpression') {
    return node.body;
  }
  if (node.body && node.body.type === 'BlockStatement') {
    for (let statement of node.body.body) {
      if (
        statement.type === 'ReturnStatement' &&
        statement.argument &&
        statement.argument.type === 'ObjectExpression'
      ) {
        return statement.argument;
      }
    }
  }
  return null;
}

function isTopLevel(scope) {
  return scope.type === 'module' || scope.type === 'global';
}

module.exports = {
  create: (context) => {
    const styleReferences = new Map();
    const styleDeclarations = new Map();

    const reportUnusedStyle = (name, node) => {
      let message = `Unused style detected: ${name}`;
      context.report(node, message);
    };

    return {
      MemberExpression(expression) {
        if (expression.computed === false) {
          let { object, property } = expression;
          if (
            object &&
            object.type === 'Identifier' &&
            property &&
            property.type === 'Identifier'
          ) {
            let objectName = object.name;
            let decl = getDeclForName(objectName, context.getScope());
            if (decl && decl.scope.type === 'function') {
              let hookName = getHookNameForDecl(decl.node);
              if (hookName) {
                let hookDecl = getDeclForName(hookName, decl.scope);
                if (
                  hookDecl &&
                  isTopLevel(hookDecl.scope) &&
                  isStyleMaker(hookDecl.node.init, context)
                ) {
                  let used = styleReferences.get(hookName);
                  if (!used) {
                    used = new Set();
                    styleReferences.set(hookName, used);
                  }
                  used.add(property.name);
                }
              }
            }
          }
        }
      },

      CallExpression(node) {
        if (isStyleMaker(node, context)) {
          let hookName = getHookNameForMaker(node);
          let styles = getStyleProperties(node);
          styleDeclarations.set(hookName, styles);
        }
      },

      ['Program:exit']() {
        for (let [hookName, styles] of styleDeclarations) {
          let usedStyles = styleReferences.get(hookName) || new Set();
          for (let [name, node] of styles) {
            if (!usedStyles.has(name)) {
              reportUnusedStyle(name, node);
            }
          }
        }
      },
    };
  },
};
