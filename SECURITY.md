# Security policy

## Supported version

Security fixes target the latest version published in the Chrome Web Store and the current `main` branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Email [me@banast.as](mailto:me@banast.as) with:

- a clear description of the issue and its potential impact;
- the affected Meridian version and browser version;
- reproduction steps or a minimal proof of concept;
- any suggested mitigation, if known.

Reports will be acknowledged as soon as practical. Please allow time to investigate and prepare a coordinated fix before public disclosure.

## Security model

Meridian is an offline-first Manifest V3 extension. It requests only the `storage` permission and has no content scripts, background service, analytics, application server, location access, or runtime network requests. Optional Chrome Sync uses the browser's storage API. Configuration imports are normalized through the same schema contract as stored data.
