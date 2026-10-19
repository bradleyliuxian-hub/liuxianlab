import base64
import json
import os
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from services.contract_review import credential_store


KEY_HEX = "b" * 64
CONTRACT_ID = "11111111-1111-1111-1111-111111111111"
OWNER = "test-owner"
TOKEN = "fictional-cross-language-token"

ROOT = Path(__file__).resolve().parents[3]
BRIDGE = ROOT / "tests" / "contracts" / "helpers" / "token-crypto-bridge.js"


def aad():
    return (
        f"contract-credential:v1:{CONTRACT_ID}:{OWNER}"
    ).encode("utf-8")


def run_node(payload):
    env = os.environ.copy()
    env["MINERU_API_TOKEN_ENCRYPTION_KEY"] = KEY_HEX

    completed = subprocess.run(
        ["node", str(BRIDGE)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env=env,
        cwd=str(ROOT),
        timeout=30,
    )

    if completed.returncode != 0:
        raise AssertionError(
            "node bridge failed: "
            + (completed.stderr or "").strip()
        )

    return json.loads(completed.stdout)


def node_record():
    record = run_node(
        {
            "mode": "encrypt",
            "token": TOKEN,
            "contractId": CONTRACT_ID,
            "ownerUsername": OWNER,
        }
    )

    return {
        "ciphertext": base64.b64decode(record["ciphertext"]),
        "iv": base64.b64decode(record["iv"]),
        "auth_tag": base64.b64decode(record["authTag"]),
        "key_version": record["keyVersion"],
    }


class CredentialStoreCryptoTests(unittest.TestCase):

    def setUp(self):
        self._env = mock.patch.dict(
            os.environ,
            {
                "MINERU_API_TOKEN_ENCRYPTION_KEY": KEY_HEX,
            },
            clear=False,
        )
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def test_node_encrypt_python_decrypt(self):
        record = node_record()

        token = credential_store.decrypt_record(
            record,
            contract_id=CONTRACT_ID,
            owner_username=OWNER,
        )

        self.assertEqual(token, TOKEN)

    def test_python_encrypt_node_decrypt(self):
        key = bytes.fromhex(KEY_HEX)
        iv = b"\x01" * 12

        combined = AESGCM(key).encrypt(
            iv,
            TOKEN.encode("utf-8"),
            aad(),
        )

        record = {
            "ciphertext": base64.b64encode(
                combined[:-16]
            ).decode("ascii"),
            "iv": base64.b64encode(iv).decode("ascii"),
            "authTag": base64.b64encode(
                combined[-16:]
            ).decode("ascii"),
            "keyVersion": 1,
        }

        result = run_node(
            {
                "mode": "decrypt",
                "record": record,
                "contractId": CONTRACT_ID,
                "ownerUsername": OWNER,
            }
        )

        self.assertEqual(result["token"], TOKEN)

    def test_tampered_ciphertext_fails(self):
        record = node_record()
        ciphertext = bytearray(record["ciphertext"])
        ciphertext[0] ^= 0xFF
        record["ciphertext"] = bytes(ciphertext)

        with self.assertRaises(
            credential_store.CredentialError
        ) as context:
            credential_store.decrypt_record(
                record,
                contract_id=CONTRACT_ID,
                owner_username=OWNER,
            )

        self.assertNotIn(
            TOKEN,
            str(context.exception),
        )

    def test_wrong_owner_fails(self):
        record = node_record()

        with self.assertRaises(
            credential_store.CredentialError
        ):
            credential_store.decrypt_record(
                record,
                contract_id=CONTRACT_ID,
                owner_username="other-owner",
            )

    def test_missing_key_is_a_clear_error(self):
        record = node_record()

        with mock.patch.dict(
            os.environ,
            {},
            clear=False,
        ):
            os.environ.pop(
                "MINERU_API_TOKEN_ENCRYPTION_KEY",
                None,
            )

            with self.assertRaises(
                credential_store.CredentialError
            ) as context:
                credential_store.decrypt_record(
                    record,
                    contract_id=CONTRACT_ID,
                    owner_username=OWNER,
                )

        self.assertIn(
            "MINERU_API_TOKEN_ENCRYPTION_KEY",
            str(context.exception),
        )
        self.assertNotIn(
            TOKEN,
            str(context.exception),
        )

    def test_bad_key_version_is_rejected(self):
        record = node_record()
        record["key_version"] = 99

        with self.assertRaises(
            credential_store.CredentialError
        ):
            credential_store.decrypt_record(
                record,
                contract_id=CONTRACT_ID,
                owner_username=OWNER,
            )


if __name__ == "__main__":
    unittest.main()
