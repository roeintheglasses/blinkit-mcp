Default to using Node.js with tsx for TypeScript execution.

- Use `tsx <file>` instead of `ts-node <file>` to run TypeScript files directly
- Use `pnpm install` instead of `npm install` or `yarn install`
- Use `pnpm run <script>` instead of `npm run <script>` or `yarn run <script>`
- Use `pnpx <package> <command>` or `npx <package> <command>` for one-off package execution
- Use dotenv or the `--env-file` flag for `.env` loading

## Testing

Use `pnpm test` to run tests (vitest).

```ts#index.test.ts
import { describe, test, expect } from "vitest";

test("hello world", () => {
  expect(1).toBe(1);
});
```
