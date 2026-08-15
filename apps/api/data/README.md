# Vendored data

## `breached-passwords.bin`

The first 8 bytes of the SHA-1 of each of the 99,839 passwords in the UK National Cyber Security Centre's most-used-passwords list, sorted, for binary search.

The NCSC published that list from the Have I Been Pwned corpus specifically so services could refuse the passwords in it. It is vendored via [SecLists](https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt).

Rebuild with:

```bash
node scripts/build-breached-password-index.mjs [path-to-wordlist.txt]
```

The script records the source URL and the checksum of the list this artifact was built from, and warns when they disagree.

### Why vendored rather than queried

Checking passwords against Have I Been Pwned's range API would put a third party inside registration, reset, and password change. When it is unreachable, both answers are bad: fail open and the check silently stops working, fail closed and someone else's outage becomes ours. A local index has neither failure mode, answers in microseconds, and tells nobody who is signing up.

### Why truncated hashes rather than a Bloom filter

A Bloom filter would be smaller, but it produces false positives — some proportion of people told their password has been breached when it has not. Sixty-four bits over a hundred thousand entries makes an accidental collision vanishingly unlikely, and 780 KB is not worth optimising.
