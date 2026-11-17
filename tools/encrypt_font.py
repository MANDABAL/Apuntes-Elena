"""Cifra la fuente + mapa de variantes con una contraseña (AES-GCM, clave PBKDF2-SHA256)."""
import base64, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

password, ttf, pua_json, out = sys.argv[1:5]
ITER = 400_000
salt, iv = os.urandom(16), os.urandom(12)
key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())
payload = json.dumps({"font": base64.b64encode(open(ttf, "rb").read()).decode(),
                      "pua": json.load(open(pua_json))}, ensure_ascii=False).encode()
data = AESGCM(key).encrypt(iv, payload, None)
b = lambda x: base64.b64encode(x).decode()
open(out, "w").write("window.LETRA_ENC=" + json.dumps({"salt": b(salt), "iv": b(iv), "iter": ITER, "data": b(data)}) + ";\n")
print("ok", len(data), "bytes cifrados")
