"""
Encrypted per-contract MinerU API credential access.

The Node upload API encrypts a user-supplied token with
AES-256-GCM and stores ciphertext / IV / auth tag in
contract_credentials. The Python worker decrypts only the row
belonging to the contract it is currently processing.

Security rules:

- The plaintext token is never logged, returned by an API, or
  written to job.json / metrics / disk.
- The AAD binds the ciphertext to contract_id + owner_username.
- A missing/invalid encryption key or a tampered record raises
  CredentialError with a non-secret message.
- Rows are deleted on terminal worker state and by TTL pruning.

cryptography is imported lazily so local-only parsing still works
in an environment where the package is absent.
"""

import base64
import os
import re

from . import database


KEY_VERSION = 1
IV_BYTES = 12
TAG_BYTES = 16

_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")

try:
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:  # pragma: no cover - depends on deployment env
    AESGCM = None
    InvalidTag = Exception


class CredentialError(RuntimeError):
    """A non-secret credential configuration/decryption error."""


def _load_key():
    raw = str(
        os.getenv(
            "MINERU_API_TOKEN_ENCRYPTION_KEY",
            "",
        )
    ).strip()

    if not raw:
        raise CredentialError(
            "服务器未配置 MINERU_API_TOKEN_ENCRYPTION_KEY"
        )

    if _HEX_RE.match(raw):
        try:
            key = bytes.fromhex(raw)
        except ValueError as error:
            raise CredentialError(
                "MINERU_API_TOKEN_ENCRYPTION_KEY 格式无效"
            ) from error
    else:
        try:
            key = base64.b64decode(raw, validate=True)
        except Exception as error:
            raise CredentialError(
                "MINERU_API_TOKEN_ENCRYPTION_KEY 格式无效"
            ) from error

    if len(key) != 32:
        raise CredentialError(
            "MINERU_API_TOKEN_ENCRYPTION_KEY 必须是 32 字节"
        )

    return key


def _aad(contract_id, owner_username):
    return (
        f"contract-credential:v{KEY_VERSION}:"
        f"{contract_id}:{owner_username}"
    ).encode("utf-8")


def decrypt_record(
    record,
    *,
    contract_id,
    owner_username,
):
    """
    Decrypt one credential record. Returns the plaintext token.

    Callers must never log the return value.
    """

    if AESGCM is None:
        raise CredentialError(
            "服务器未安装 cryptography，无法解密云端凭证"
        )

    key_version = int(
        record.get("key_version")
        or record.get("keyVersion")
        or 0
    )

    if key_version != KEY_VERSION:
        raise CredentialError(
            "云端凭证版本不受支持"
        )

    ciphertext = bytes(record.get("ciphertext") or b"")
    iv = bytes(record.get("iv") or b"")
    auth_tag = bytes(
        record.get("auth_tag")
        or record.get("authTag")
        or b""
    )

    if (
        not ciphertext
        or len(iv) != IV_BYTES
        or len(auth_tag) != TAG_BYTES
    ):
        raise CredentialError(
            "云端凭证格式无效"
        )

    try:
        plaintext = AESGCM(_load_key()).decrypt(
            iv,
            ciphertext + auth_tag,
            _aad(
                str(contract_id),
                str(owner_username),
            ),
        )
    except CredentialError:
        raise
    except Exception as error:
        raise CredentialError(
            "云端凭证解密失败（数据可能被篡改或密钥已更换）"
        ) from error

    try:
        text = plaintext.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CredentialError(
            "云端凭证内容无效"
        ) from error

    if not text.strip():
        raise CredentialError(
            "云端凭证内容为空"
        )

    return text


def get_contract_token(
    contract_id,
    owner_username=None,
):
    """
    Return the decrypted token for this contract, or None.

    Expired rows are ignored (and later pruned). An owner mismatch
    is treated as tampering, not as a usable credential.
    """

    with database.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    owner_username,
                    ciphertext,
                    iv,
                    auth_tag,
                    key_version
                FROM contract_credentials
                WHERE
                    contract_id = %s
                    AND expires_at > NOW()
                LIMIT 1
                """,
                (
                    contract_id,
                ),
            )

            row = cur.fetchone()

    if row is None:
        return None

    (
        stored_owner,
        ciphertext,
        iv,
        auth_tag,
        key_version,
    ) = row

    if (
        owner_username is not None
        and str(stored_owner) != str(owner_username)
    ):
        raise CredentialError(
            "云端凭证与合同 owner 不匹配"
        )

    return decrypt_record(
        {
            "ciphertext": ciphertext,
            "iv": iv,
            "auth_tag": auth_tag,
            "key_version": key_version,
        },
        contract_id=contract_id,
        owner_username=stored_owner,
    )


def delete_contract_credential(contract_id):
    """
    Delete one credential row. Best-effort callers may catch
    exceptions; this function itself is not silent.
    """

    with database.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM contract_credentials
                WHERE contract_id = %s
                """,
                (
                    contract_id,
                ),
            )

            return cur.rowcount


def prune_expired_credentials():
    """
    Delete expired credentials. Returns the number removed.

    Called best-effort by the worker on startup / between jobs.
    """

    with database.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM contract_credentials
                WHERE expires_at <= NOW()
                """
            )

            return cur.rowcount
