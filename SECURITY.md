# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of @jfungus/ratelimit seriously. If you have discovered a security vulnerability, please report it responsibly.

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please send an email to the maintainers or use GitHub's private vulnerability reporting feature:

1. Go to the [Security tab](https://github.com/rokasta12/ratelimit/security) of this repository
2. Click "Report a vulnerability"
3. Provide a detailed description of the vulnerability

### What to include in your report

- Type of vulnerability (e.g., bypass, denial of service, information disclosure)
- Full paths of source file(s) related to the vulnerability
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the vulnerability

### What to expect

- Acknowledgment of your report within 48 hours
- Regular updates on the progress of addressing the vulnerability
- Credit in the security advisory (if you wish)

## Security Best Practices

When using @jfungus/ratelimit in production:

1. **Use distributed storage** for multi-instance deployments (Redis, Cloudflare KV, etc.)
2. **Set appropriate limits** based on your application's needs
3. **Monitor rate limiting** to detect potential attacks
4. **Keep dependencies updated** to receive security patches

Thank you for helping keep @jfungus/ratelimit secure!
