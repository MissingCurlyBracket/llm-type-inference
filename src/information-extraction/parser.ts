
import * as parser from '@babel/parser';

export const babelParse = (code: string) => {
    return parser.parse(code, {
        sourceType: 'module',
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: [
            'jsx',
            'typescript',
            'decorators-legacy',
            'classProperties',
            'asyncGenerators',
            'functionBind',
            'exportDefaultFrom',
            'exportNamespaceFrom',
            'dynamicImport',
            'nullishCoalescingOperator',
            'optionalChaining'
        ]
    });
};
