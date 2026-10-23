"""
Codificador MessagePack mínimo (só biblioteca padrão), para enviar áudio de referência ao Fish Audio:
o corpo em JSON não carrega bytes, o MessagePack carrega. Cobre o que o BMX envia: None, bool, int,
float, str, bytes, list e dict.
"""
import struct


def pack(obj):
    if obj is None:
        return b"\xc0"
    if obj is True:
        return b"\xc3"
    if obj is False:
        return b"\xc2"
    if isinstance(obj, int):
        if 0 <= obj < 128:
            return bytes([obj])
        if -32 <= obj < 0:
            return struct.pack("b", obj)
        if 0 <= obj < 2 ** 32:
            return b"\xce" + struct.pack(">I", obj)
        return b"\xd3" + struct.pack(">q", obj)
    if isinstance(obj, float):
        return b"\xcb" + struct.pack(">d", obj)
    if isinstance(obj, str):
        b = obj.encode("utf-8")
        n = len(b)
        if n < 32:
            return bytes([0xA0 | n]) + b
        if n < 256:
            return b"\xd9" + bytes([n]) + b
        if n < 65536:
            return b"\xda" + struct.pack(">H", n) + b
        return b"\xdb" + struct.pack(">I", n) + b
    if isinstance(obj, (bytes, bytearray)):
        n = len(obj)
        if n < 256:
            return b"\xc4" + bytes([n]) + bytes(obj)
        if n < 65536:
            return b"\xc5" + struct.pack(">H", n) + bytes(obj)
        return b"\xc6" + struct.pack(">I", n) + bytes(obj)
    if isinstance(obj, (list, tuple)):
        n = len(obj)
        cab = bytes([0x90 | n]) if n < 16 else (b"\xdc" + struct.pack(">H", n) if n < 65536 else b"\xdd" + struct.pack(">I", n))
        return cab + b"".join(pack(x) for x in obj)
    if isinstance(obj, dict):
        n = len(obj)
        cab = bytes([0x80 | n]) if n < 16 else (b"\xde" + struct.pack(">H", n) if n < 65536 else b"\xdf" + struct.pack(">I", n))
        return cab + b"".join(pack(k) + pack(v) for k, v in obj.items())
    raise TypeError(f"msgpack_mini não sabe codificar {type(obj).__name__}")
