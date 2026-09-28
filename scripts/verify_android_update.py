"""Verify APK update identity before publishing (requires androguard).

Usage: python scripts/verify_android_update.py previous.apk candidate.apk
This checks update metadata; it does not replace an on-device installation test.
"""
import argparse
import hashlib
import json


def inspect_apk(path):
    from loguru import logger
    from androguard.core.apk import APK
    logger.remove()
    apk = APK(str(path))
    certs = apk.get_certificates_der_v2() + apk.get_certificates_der_v3()
    return {
        'packageName': apk.get_package(),
        'version': apk.get_androidversion_name(),
        'versionCode': int(apk.get_androidversion_code()),
        'minSdk': int(apk.get_min_sdk_version()),
        'signatures': sorted({hashlib.sha256(cert).hexdigest() for cert in certs}),
        'abis': sorted({name.split('/')[1] for name in apk.get_files() if name.startswith('lib/')}),
    }


def verify_update(previous, candidate):
    if candidate['packageName'] != previous['packageName']:
        raise ValueError('Identifiant Android différent : installation séparée')
    if not candidate['signatures'] or candidate['signatures'] != previous['signatures']:
        raise ValueError('Signature différente : Android refusera le remplacement')
    if candidate['versionCode'] <= previous['versionCode']:
        raise ValueError('Le numéro de build doit augmenter')
    if candidate['minSdk'] > previous['minSdk']:
        raise ValueError('Des versions Android précédemment compatibles sont exclues')
    if not set(previous['abis']).issubset(candidate['abis']):
        raise ValueError('Des architectures précédemment compatibles sont exclues')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('previous')
    parser.add_argument('candidate')
    args = parser.parse_args()
    previous, candidate = inspect_apk(args.previous), inspect_apk(args.candidate)
    verify_update(previous, candidate)
    print(json.dumps({'compatibleUpdate': True, **candidate}, indent=2))
