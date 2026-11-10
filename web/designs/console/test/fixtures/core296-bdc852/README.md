# Actual Core Producer Fixtures

These deterministic gzip files contain unmodified JSON emitted by Core producer
`bdc852c6b61ff0fdb312fb8489c0f2f85cbbe2d1` from synthetic test databases, not
user conversations. Gzip uses timestamp zero. `provenance.json` records both
compressed and original byte hashes and the original private export manifest
hash. The schema is the actual generated schema, not a handcrafted substitute.

The export used `CORE296_FIXTURE_DIR` and the registered
`history_window_items` integration tests, including the public `Store.execute`
route regression. The original export shell was
`3a5b2c82-44b6-4c1f-965d-3622e25ded0b` (7 passing public tests, six valid schema
responses and six rejected mutations). Original schema SHA256:
`2ead1944fbf71969f3eaa79c2b11f71e2410284dd2fa4d8e6f819b04d81537f1`.

The loader verifies compressed and original hashes before JSON parsing. Keeping
these small compressed fixtures in the repository makes CI independent of local
artifact directories without skipping any actual-input assertion. No live owner
response, credentials, screenshots, database files or private runtime logs are
included.
