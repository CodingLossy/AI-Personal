# Provider fixtures

Recorded HTTP interactions replayed by the provider tests. Files with `"synthetic": true` were written by hand from the OpenAI-compatible streaming format and have not yet been recorded against a real endpoint.

To re-record against a real endpoint (keys are read from the environment and redacted before anything is written):

```bash
AIP_EVAL_LIVE=1 AIP_EVAL_BASE_URL=https://api.example.com/v1 AIP_EVAL_MODEL=model-name AIP_EVAL_KEY_ENV=MY_API_KEY \
  pnpm --filter @ai-personal/providers test
```

`pnpm check:secrets` fails if anything that looks like a credential appears in a fixture.
