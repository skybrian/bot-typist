import * as assert from "assert";
import { Readable } from "stream";
import { copyStream, Reader, DONE } from "../../lib/streams";

const collectChunks = async (r: Reader): Promise<string[]> => {
  const chunks = [] as string[];
  while (true) {
    const chunk = await r.read();
    if (chunk === DONE) {
      return chunks;
    }
    chunks.push(chunk);
  }
};

describe('copyStream', () => {
  it('sends each chunk to the read function', async function() {
    const input = ['hello', 'world'];
    const source = Readable.from(input);

    const output = await copyStream(source, collectChunks);

    assert.deepStrictEqual(output, input);
    assert.ok(source.destroyed);
  });

  it('stops early when the read function returns early', async function() {
    const input = ['hello', 'world'];
    const source = Readable.from(input);

    const first = await copyStream(source, async (r) => {
      return await r.read();
    });

    assert.strictEqual(first, 'hello');
    assert.ok(source.destroyed);
  });

  it("sends a stream error to the read function", async () => {
      const source = new Readable({
          read() {}
      });

      const pending = copyStream(source, async (r) => {
        await r.read(); // should throw
        return "shouldn't get here";
      });

      source.emit('error', 'test error');

      await assert.rejects(pending, (err) => {
        assert.strictEqual(err, 'test error');
        return true;
      });
      assert.ok(source.destroyed);
    });
});
