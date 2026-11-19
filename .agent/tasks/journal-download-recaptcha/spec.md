# Journal template downloads and historical bots
Frozen before implementation.
- AC1 Google reCAPTCHA v2 is required on the server before issuing a new signed download, recording a lead, registering an account or sending mail. Verify hostname and fail closed.
- AC2 First-time and remembered-email requests can solve the localized checkbox, retry with a fresh token and use the existing signed file flow.
- AC3 Inspect production download records and remove confirmed bot downloaders where attribution is unambiguous. Report counts and unresolved cases without exposing personal data.
- AC4 Run the repository typecheck and targeted gate on current source and record results.
