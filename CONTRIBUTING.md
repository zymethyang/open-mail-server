# Contributing

Thank you for helping improve Open Mail Server. This project is small, dependency-free, and written in TypeScript.

## Setting up the project

1. Node.js 20 or newer is required.
2. Install the dependencies.

```bash
npm ci
```

3. Check the types and run the test suite.

```bash
npm run check
npm test
```

4. Build the server and the web client.

```bash
npm run build
npm start
```

## Writing changes

- Keep the code clear and readable. Avoid abbreviations and do not add comments that do not help the reader.
- Add or update tests for new behavior. The test suite runs with the built-in `node --test` runner.
- Do not add runtime dependencies unless the change genuinely needs them. This project has none today.
- Keep the existing folder structure: server components live under `src/components`, and the web client lives under `src/web`.

## Submitting a pull request

- Keep the change focused on one thing.
- Make sure `npm run check` and `npm test` both pass.
- Describe what changed and why in the pull request.
