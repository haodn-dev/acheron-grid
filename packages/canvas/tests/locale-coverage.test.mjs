import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { canvasEnglishMessages, canvasVietnameseMessages } from '../dist/locale.js';

const directory = fileURLToPath(new URL('../', import.meta.url));
const config = ts.readConfigFile(directory + 'tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const sources = program.getSourceFiles().filter((source) => parsed.fileNames.includes(source.fileName));
const calls = [];
const pushes = [];
function walk(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => walk(child, callback));
}
for (const source of sources)
  walk(source, (node) => {
    if (ts.isCallExpression(node)) {
      calls.push(node);
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'push') pushes.push(node);
    }
  });
function translator(node) {
  return checker.getTypeAtLocation(node.expression).aliasSymbol?.name === 'CanvasTranslator';
}
function strings(node, seen = new Set()) {
  if (!node || seen.has(node)) return [];
  seen = new Set(seen).add(node);
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...strings(node.whenTrue, seen), ...strings(node.whenFalse, seen)];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return strings(node.expression, seen);
  if (ts.isCallExpression(node) && translator(node)) return [];
  if (ts.isTemplateExpression(node)) {
    let results = [node.head.text];
    let placeholder = 0;
    node.templateSpans.forEach((span) => {
      const alternatives = strings(span.expression, seen);
      results = results.flatMap((prefix) =>
        (alternatives.length ? alternatives : [`{${placeholder}}`]).map((value) => prefix + value + span.literal.text),
      );
      if (!alternatives.length) placeholder++;
    });
    return results;
  }
  if (ts.isElementAccessExpression(node) && ts.isObjectLiteralExpression(node.expression))
    return node.expression.properties.flatMap((property) =>
      ts.isPropertyAssignment(property) ? strings(property.initializer, seen) : [],
    );
  const type = checker.getTypeAtLocation(node);
  const types = type.isUnion() ? type.types : [type];
  if (types.every((item) => item.isStringLiteral())) return types.map((item) => item.value);
  if (ts.isIdentifier(node)) {
    const declarations = checker.getSymbolAtLocation(node)?.declarations ?? [];
    return declarations.flatMap((declaration) => {
      if (ts.isVariableDeclaration(declaration)) return strings(declaration.initializer, seen);
      if (ts.isParameter(declaration)) {
        const owner = declaration.parent;
        if (ts.isFunctionDeclaration(owner) && owner.name) {
          const symbol = checker.getSymbolAtLocation(owner.name);
          const index = owner.parameters.indexOf(declaration);
          return calls
            .filter((call) => checker.getSymbolAtLocation(call.expression) === symbol)
            .flatMap((call) => strings(call.arguments[index], seen));
        }
        if (ts.isArrowFunction(owner) && ts.isCallExpression(owner.parent)) {
          const map = owner.parent.expression;
          if (ts.isPropertyAccessExpression(map) && map.name.text === 'map') {
            let producer = map.expression;
            if (ts.isIdentifier(producer))
              producer = checker.getSymbolAtLocation(producer)?.valueDeclaration?.initializer;
            if (producer && ts.isCallExpression(producer)) {
              const name = ts.isPropertyAccessExpression(producer.expression)
                ? producer.expression.name.text
                : producer.expression.getText();
              if (name === 'stateLabels' || name === 'rowLabels')
                return pushes.flatMap((push) => {
                  let fn = push.parent;
                  while (fn && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
                  return fn?.name?.text === name ? push.arguments.flatMap((argument) => strings(argument, seen)) : [];
                });
            }
          }
        }
      }
      if (ts.isBindingElement(declaration) && ts.isArrayBindingPattern(declaration.parent)) {
        const variable = declaration.parent.parent;
        const loop = variable.parent.parent;
        if (ts.isForOfStatement(loop) && ts.isIdentifier(loop.expression)) {
          const array = checker.getSymbolAtLocation(loop.expression)?.valueDeclaration?.initializer;
          if (array && ts.isArrayLiteralExpression(array))
            return array.elements.flatMap((entry) =>
              ts.isArrayLiteralExpression(entry)
                ? strings(entry.elements[declaration.parent.elements.indexOf(declaration)], seen)
                : [],
            );
        }
      }
      return [];
    });
  }
  return [];
}

test('every statically owned Canvas translator message exists in both catalogs', () => {
  const messages = new Map();
  const unresolved = [];
  function collect(node) {
    const location = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
    const origin = `${node.getSourceFile().fileName}:${location.line + 1}`;
    const values = strings(node);
    for (const value of values) messages.set(value, origin);
    return values.length;
  }
  for (const call of calls.filter(translator)) {
    const argument = call.arguments[0];
    if (collect(argument)) continue;
    // Host/core errors and already translated labels retain the translator's runtime fallback.
    if (ts.isPropertyAccessExpression(argument) && argument.name.text === 'message') continue;
    if (ts.isIdentifier(argument) && argument.text === 'label') {
      const declaration = checker.getSymbolAtLocation(argument)?.valueDeclaration;
      const map = declaration?.parent?.parent;
      if (map && ts.isCallExpression(map) && ts.isPropertyAccessExpression(map.expression)) {
        const receiver = map.expression.expression;
        const producer = ts.isIdentifier(receiver)
          ? checker.getSymbolAtLocation(receiver)?.valueDeclaration?.initializer
          : receiver;
        if (producer && ts.isCallExpression(producer) && producer.expression.getText().endsWith('.rowLabels')) continue;
      }
    }
    unresolved.push(`${call.getSourceFile().fileName}: ${argument.getText()}`);
  }
  // Labels stored in arrays lose their literal type before map/for-of passes them to the translator.
  for (const push of pushes) {
    let owner = push.parent;
    while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
    if (owner?.name?.text === 'stateLabels' || owner?.name?.text === 'rowLabels')
      for (const argument of push.arguments) collect(argument);
  }
  for (const source of sources)
    walk(source, (node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText() === 'lockTargets')
        for (const entry of node.initializer.elements) collect(entry.elements[0]);
    });
  assert.deepEqual(unresolved, [], 'new dynamic translator arguments need a source trace');
  const missing = [];
  for (const [message, origin] of messages)
    for (const [language, catalog] of [
      ['English', canvasEnglishMessages],
      ['Vietnamese', canvasVietnameseMessages],
    ])
      if (!Object.hasOwn(catalog, message)) missing.push(`${language}: ${JSON.stringify(message)} (${origin})`);
  assert.deepEqual(missing, [], 'missing Canvas translations');
  assert.ok(messages.size > 200, `unexpectedly small message inventory: ${messages.size}`);
  console.log(
    `Canvas localization inventory: ${messages.size} keys, ${calls.filter(translator).length} translator calls`,
  );
});

test('message scanner preserves whitespace and resolves conditional template prefixes', () => {
  const source = ts.createSourceFile(
    'messages.ts',
    "const message = `${locked ? 'Unlock' : 'Lock'} ${name}`; const hint = ' trailing ';",
    ts.ScriptTarget.Latest,
    true,
  );
  assert.deepEqual(strings(source.statements[0].declarationList.declarations[0].initializer), [
    'Unlock {0}',
    'Lock {0}',
  ]);
  assert.deepEqual(strings(source.statements[1].declarationList.declarations[0].initializer), [' trailing ']);
});
