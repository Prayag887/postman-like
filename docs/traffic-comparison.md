# Traffic comparison

Endpoint identity combines method, normalized host, path template, content type, and request-shape fingerprint. Numeric, UUID, and long hexadecimal path segments normalize to `{id}`, while static routes such as `/users/me` remain distinct.

JSON is parsed and object keys are sorted recursively. Missing values remain distinct from null, types remain distinct, and array order is preserved. Project rules may ignore specific paths or established volatile fields.

The data model supports previous compatible observations and user-approved baselines. Incompatible traffic must remain neutral rather than showing a red regression.

Differences are typed and classified as critical, warning, or informational. Changed rows use focused red styling; warnings use amber.
