import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import * as prettier from 'prettier';
import kebabCase from 'lodash/kebabCase';
import { getLineFeed } from '@mui-internal/docs-utilities';
import { replaceComponentLinks } from './utils/replaceUrl';
import { TypeScriptProject } from './utils/createTypeScriptProject';

/**
 * TODO: this should really be fixed in findPagesMarkdown().
 * Plus replaceComponentLinks() shouldn't exist in the first place,
 * the markdown folder location should match the URLs.
 */
export function fixPathname(pathname: string): string {
  let fixedPathname;

  if (pathname.startsWith('/material')) {
    fixedPathname = replaceComponentLinks(`${pathname.replace(/^\/material/, '')}/`);
  } else if (pathname.startsWith('/joy')) {
    fixedPathname = replaceComponentLinks(`${pathname.replace(/^\/joy/, '')}/`).replace(
      'material-ui',
      'joy-ui',
    );
  } else if (pathname.startsWith('/base')) {
    fixedPathname = `${pathname
      .replace('/base/', '/base-ui/')
      .replace('/components/', '/react-')}/`;
  } else {
    fixedPathname = `${pathname.replace('/components/', '/react-')}/`;
  }

  return fixedPathname;
}

const DEFAULT_PRETTIER_CONFIG_PATH = path.join(process.cwd(), 'prettier.config.js');

export function writePrettifiedFile(
  filename: string,
  data: string,
  prettierConfigPath: string = DEFAULT_PRETTIER_CONFIG_PATH,
  options: object = {},
) {
  const prettierConfig = prettier.resolveConfig.sync(filename, {
    config: prettierConfigPath,
  });
  if (prettierConfig === null) {
    throw new Error(
      `Could not resolve config for '${filename}' using prettier config path '${prettierConfigPath}'.`,
    );
  }

  fs.writeFileSync(filename, prettier.format(data, { ...prettierConfig, filepath: filename }), {
    encoding: 'utf8',
    ...options,
  });
}

let systemComponents: string[] | undefined;
// making the resolution lazy to avoid issues when importing something irrelevant from this file (i.e. `getSymbolDescription`)
// the eager resolution results in errors when consuming externally (i.e. `mui-x`)
export function getSystemComponents() {
  if (!systemComponents) {
    systemComponents = fs
      .readdirSync(path.resolve('packages', 'mui-system', 'src'))
      .filter((pathname) => pathname.match(/^[A-Z][a-zA-Z]+$/));
  }
  return systemComponents;
}

export function getMuiName(name: string) {
  return `Mui${name.replace('Styled', '')}`;
}

export function extractPackageFile(filePath: string) {
  filePath = filePath.replace(new RegExp(`\\${path.sep}`, 'g'), '/');
  const match = filePath.match(
    /.*\/packages.*\/(?<packagePath>[^/]+)\/src\/(.*\/)?(?<name>[^/]+)\.(js|tsx|ts|d\.ts)/,
  );
  const result = {
    packagePath: match ? match.groups?.packagePath! : null,
    name: match ? match.groups?.name! : null,
  };
  return {
    ...result,
    muiPackage: result.packagePath?.replace('x-', 'mui-'),
  };
}

export function parseFile(filename: string) {
  const src = fs.readFileSync(filename, 'utf8');
  return {
    src,
    shouldSkip:
      filename.indexOf('internal') !== -1 ||
      !!src.match(/@ignore - internal component\./) ||
      !!src.match(/@ignore - internal hook\./) ||
      !!src.match(/@ignore - do not document\./),
    spread: !src.match(/ = exactProp\(/),
    EOL: getLineFeed(src),
    inheritedComponent: src.match(/\/\/ @inheritedComponent (.*)/)?.[1],
  };
}

export type ComponentInfo = {
  /**
   * Full path to the source file.
   */
  filename: string;
  /**
   * Component name as imported in the docs, in the global MUI namespace.
   */
  name: string;
  /**
   * Component name with `Mui` prefix, in the global HTML page namespace.
   */
  muiName: string;
  apiPathname: string;
  readFile: () => {
    src: string;
    spread: boolean;
    shouldSkip: boolean;
    EOL: string;
    inheritedComponent?: string;
  };
  getInheritance: (inheritedComponent?: string) => null | {
    /**
     * Component name
     */
    name: string;
    /**
     * API pathname
     */
    apiPathname: string;
  };
  getDemos: () => Array<{ demoPageTitle: string; demoPathname: string }>;
  apiPagesDirectory: string;
  skipApiGeneration?: boolean;
  /**
   * If `true`, the component's name match one of the system components.
   */
  isSystemComponent?: boolean;
};

export type HookInfo = {
  /**
   * Full path to the source file.
   */
  filename: string;
  /**
   * Hook name as imported in the docs, in the global MUI namespace.
   */
  name: string;
  apiPathname: string;
  readFile: ComponentInfo['readFile'];
  getDemos: ComponentInfo['getDemos'];
  apiPagesDirectory: string;
  skipApiGeneration?: boolean;
};

export const getApiPath = (
  demos: Array<{ demoPageTitle: string; demoPathname: string }>,
  name: string,
) => {
  let apiPath = null;

  if (demos && demos.length > 0) {
    // remove the hash from the demoPathname, for e.g. "#hooks"
    const cleanedDemosPathname = demos[0].demoPathname.split('#')[0];
    apiPath = `${cleanedDemosPathname}${
      name.startsWith('use') ? 'hooks-api' : 'components-api'
    }/#${kebabCase(name)}`;
  }

  return apiPath;
};

export function formatType(rawType: string) {
  if (!rawType) {
    return '';
  }

  const prefix = 'type FakeType = ';
  const signatureWithTypeName = `${prefix}${rawType}`;

  const prettifiedSignatureWithTypeName = prettier.format(signatureWithTypeName, {
    printWidth: 999,
    singleQuote: true,
    semi: false,
    trailingComma: 'none',
    parser: 'typescript',
  });

  return prettifiedSignatureWithTypeName.slice(prefix.length).replace(/\n$/, '');
}

export function getSymbolDescription(symbol: ts.Symbol, project: TypeScriptProject) {
  return symbol
    .getDocumentationComment(project.checker)
    .flatMap((comment) => comment.text.split('\n'))
    .filter((line) => !line.startsWith('TODO'))
    .join('\n');
}

export function getSymbolJSDocTags(symbol: ts.Symbol) {
  return Object.fromEntries(symbol.getJsDocTags().map((tag) => [tag.name, tag]));
}

export function stringifySymbol(symbol: ts.Symbol, project: TypeScriptProject) {
  let rawType: string;

  const declaration = symbol.declarations?.[0];
  if (declaration && ts.isPropertySignature(declaration)) {
    rawType = declaration.type?.getText() ?? '';
  } else {
    rawType = project.checker.typeToString(
      project.checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration!),
      symbol.valueDeclaration,
      ts.TypeFormatFlags.NoTruncation,
    );
  }

  return formatType(rawType);
}
