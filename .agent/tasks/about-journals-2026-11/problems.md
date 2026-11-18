# Verification findings

- The initial test gate reported a stale generated translation artifact on the Windows checkout. The generator writes LF and Git had restored CRLF in the unchanged sibling outputs. Regenerate all outputs before verification. Git normalizes the unchanged siblings, so only the updated main contract belongs in the diff.
