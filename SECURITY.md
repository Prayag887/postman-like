# Security policy

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not include live credentials, access tokens, or unredacted production responses in a report.

APIQA is local-first and sends no telemetry. It redacts common authorization and cookie response headers before persistence, omits secret-like environment values from exported projects, and stores remaining project and response data in the current user's application-data directory. Users should still treat exported reports and `.apiqa` projects as potentially sensitive.

Only the latest release receives security fixes.

