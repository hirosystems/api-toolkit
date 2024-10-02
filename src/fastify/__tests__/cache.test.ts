import { parseIfNoneMatchHeader } from '../cache';

describe('cache', () => {
  test('parse if-none-match header', () => {
    // Test various combinations of etags with and without weak-validation prefix, with and without
    // wrapping quotes, without and without spaces after commas.
    const vectors: {
      input: string | undefined;
      output: string[] | undefined;
    }[] = [
      { input: '""', output: undefined },
      { input: '', output: undefined },
      { input: undefined, output: undefined },
      {
        input: '"bfc13a64729c4290ef5b2c2730249c88ca92d82d"',
        output: ['bfc13a64729c4290ef5b2c2730249c88ca92d82d'],
      },
      { input: 'W/"67ab43", "54ed21", "7892dd"', output: ['67ab43', '54ed21', '7892dd'] },
      { input: '"fail space" ', output: ['fail space'] },
      { input: 'W/"5e15153d-120f"', output: ['5e15153d-120f'] },
      {
        input: '"<etag_value>", "<etag_value>" , "asdf"',
        output: ['<etag_value>', '<etag_value>', 'asdf'],
      },
      {
        input: '"<etag_value>","<etag_value>","asdf"',
        output: ['<etag_value>', '<etag_value>', 'asdf'],
      },
      {
        input: 'W/"<etag_value>","<etag_value>","asdf"',
        output: ['<etag_value>', '<etag_value>', 'asdf'],
      },
      {
        input: '"<etag_value>",W/"<etag_value>", W/"asdf", "abcd","123"',
        output: ['<etag_value>', '<etag_value>', 'asdf', 'abcd', '123'],
      },
    ];
    expect(vectors).toBeTruthy();
    for (const entry of vectors) {
      const result = parseIfNoneMatchHeader(entry.input);
      expect(result).toEqual(entry.output);
    }
  });
});
