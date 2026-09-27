# Saakshi protocol v1

Normative. This document describes exactly what `packages/core/src` does at protocol version `V = 1`.
Where this document and the code disagree, the golden vectors in `fixtures/vectors/protocol-v1.json` decide.

## 1. Status

- **Frozen 2026-09-27.**
- Any change to a byte that is hashed, signed, encrypted or encoded requires `V = 2`, new golden vectors and new fixtures.
- v1 is implemented by:

| Module | Contents |
|---|---|
| `bytes.ts` | hex, UTF-8, concatenation, Crockford-80 codes |
| `canon.ts` | canonical encoding |
| `protocol.ts` | domain bytes, structure layouts, hashes, counts, receipt code, `kc_f` |
| `sig.ts` | low-S normalisation, noble verifier |
| `node.ts` | native keys, signer and verifier, ECDH, body envelope |
| `merkle.ts` | RFC 9162 tree, inclusion and consistency proofs |
| `custody.ts` | offline code, per-centre wrap, Shamir 2-of-3 |
| `journal.ts` | signed chain lines, chain verifier |
| `schema.ts` | cohort and export row validation |

## 2. Canonical encoding

`canon(v)` is `JSON.stringify(v)` after these checks. The bytes that get hashed are the **UTF-8 encoding of that output**.

- The top level is an array whose first element is a string (the type tag).
- Allowed values are only:
  - strings;
  - numbers that are safe integers (`Number.isSafeInteger`, so |n| ≤ 2^53−1), excluding `-0`;
  - arrays of allowed values. Sparse arrays are rejected.
- No objects, floats, `NaN`/`Infinity`, `-0`, `null`, booleans or `undefined`.
- The output is compact: no whitespace. String escaping is `JSON.stringify`'s:
  - `"` and `\` are escaped;
  - control characters below U+0020 become `\b \f \n \r \t` or `\u00xx`, in lowercase hex;
  - lone surrogates become `\udxxx`;
  - all other characters, including Devanagari, are emitted raw and then UTF-8 encoded.
- `parseCanon(text)` runs `JSON.parse`, then requires `canon(result) === text` byte for byte. Any other spelling of the same value is rejected.

Vectors (`canon.accept`, `canon.reject`):

| Input text | Result |
|---|---|
| `["x",1,"a",[2,["b"]]]` | accepted |
| `["x","हिन्दी"]` | accepted |
| `["x", 1]` | rejected: whitespace |
| `["x",1.0]`, `["x",1e2]` | rejected: not the canonical spelling |
| `["x",-0]` | rejected: −0 |
| `{"a":1}`, `["x",null]`, `["x",true]` | rejected: disallowed type |
| `[1,"x"]` | rejected: no type tag |

## 3. Domain bytes

Every hash starts with a single domain byte, so a structure of one kind can never be read as another.

| Byte | Name (`D.*`) | Used in |
|---|---|---|
| `0x00` | `LEAF` | Merkle leaf hash |
| `0x01` | `NODE` | Merkle interior node hash |
| `0x02` | `ENTRY` | entry hash `h`, and the signed message |
| `0x03` | `GENESIS` | the genesis `prev` |
| `0x04` | `BODY` | `bodyCommit` |
| `0x05` | `RECEIPT` | receipt code |
| `0x06` | `FINAL` | `finalHash` |
| `0x07` | `KEYCOMMIT` | key commitment `kc_f` |

- `tagged(d, v)` = `d ‖ UTF-8(canon(v))`.
- `hashTagged(d, v)` = `SHA-256(tagged(d, v))`.

## 4. Hex and keys

- Every hash inside a protocol array is **64 lowercase hex characters**. Parsers check `^[0-9a-f]{64}$`.
- Public keys are **65-byte uncompressed P-256** points (`04 ‖ x ‖ y`). Anything else is rejected.
- Private keys are **32 bytes**, big-endian. They are left-padded with zeros when Node returns fewer.
- A signature is 64 bytes (`r ‖ s`), carried as 128 lowercase hex characters.

## 5. Structure layouts

`v` is the literal integer `1`. Every field is a string or safe integer unless noted.

| Structure | Array | Hash |
|---|---|---|
| genesis | `["saakshi-genesis",v,exam,shift,attempt,cand]` | `SHA-256(0x03 ‖ canon)` → the first `prev` |
| entry header | `["entry",v,exam,shift,attempt,cand,keyEpoch,seq,prev,kind,tMonoMs,activeMs,bodyCommit]` | `h = SHA-256(0x02 ‖ canon)` |
| body | `["body",item,state,answer,meta]` | `bodyCommit = SHA-256(0x04 ‖ salt(16) ‖ canon)` |
| final | `["final",exam,shift,attempt,cand,form,responses]` | `finalHash = SHA-256(0x06 ‖ canon)` |
| receipt | `["receipt",exam,shift,attempt,pseud,seq,h,finalHash,attempted,answered,marked]` | `SHA-256(0x05 ‖ canon)` → receipt code |
| leaf | `["leaf",exam,shift,attempt,pseud,h,finalHash]` | `SHA-256(0x00 ‖ canon)` (see §10) |
| key commitment | *(raw bytes, not an array)* | `kc_f = SHA-256(0x07 ‖ K)` |

Notes:

- `bodyCommit` places the 16-byte salt **between** the domain byte and the JSON. It is therefore not a `tagged()` hash.
- In `final`, `responses` is an array of `[item,state,answer]`. It is sorted by `item` in ascending UTF-16 code-unit order, as JS `<` compares. A duplicate `item` is an error.
- In `receipt` and `leaf`, `pseud` is an opaque string. The vectors use 64 × `7`. The receipt code is `crockford80(hash)` (§9): the first 10 bytes of the hash as 16 symbols, plus a check symbol.

**Reserved layouts.** These have no implementation or vectors in v1. They are listed here only to reserve the tags and field order for later stages:

| Tag | Array |
|---|---|
| STH | `["sth",exam,shift,size,root,prevSTH,ts]` |
| ack | `["ack",exam,shift,attempt,cand,keyEpoch,seq,h]` |
| bind | `["bind",exam,shift,attempt,cand,seatId,pubkey,keyEpoch,fromSeq,attestHash]` |
| handover | `["handover",…,fromSeq,fromHead,newPub]` (the elided fields are fixed when handover is implemented) |
| release | `["release",exam,shift,form,kc_f,ts]` |

**Example** (`ctx = {exam:"DEMO-2026", shift:"S1", attempt:1, cand:"C0001"}`):

```
genesis canon  ["saakshi-genesis",1,"DEMO-2026","S1",1,"C0001"]
genesisPrev    5d69bc2c61786a76aca971f7b9dce3b2d12f9e592b92cc102720078d6564fd8a

salt           000102030405060708090a0b0c0d0e0f
body canon     ["body","I17","A","B",[4200,["हिन्दी"]]]          (52 bytes UTF-8)
bodyCommit     569ca0a8b89f49a2bb9114f5a1b01af2ce890d59cc7677990b83ea7f7d0315d4

header canon   ["entry",1,"DEMO-2026","S1",1,"C0001",1,1,"5d69bc2c61786a76aca971f7b9dce3b2d12f9e592b92cc102720078d6564fd8a","answer",61000,60500,"569ca0a8b89f49a2bb9114f5a1b01af2ce890d59cc7677990b83ea7f7d0315d4"]
m              02 5b … (0x02 ‖ UTF-8 of the header canon)
h              3f36c544d3f1a98de5da799cd857a2738d454193a636291169bf8d6ed77b6877

responses      [["I17","AMR","B"],["I03","A","C"],["I05","MR",""]]  (hashed sorted: I03, I05, I17)
finalHash      57c9e6df0d30bdcdef888cd1ae4e0212692ca58d6d7000bfd9eba519af561752
counts         attempted 3, answered 2, marked 2
receipt code   N5JY1E59BR0FGNVQW

K              32 × 0x11
kc_f           6065a397d8b6299bbacba68453af1f9920929f4f02b067fd04f86d7ad43f0ba5
```

## 6. Entries

**Header parsing** (`headerFromArray`) rejects the header unless all of these hold:

- it has exactly 13 elements, tag `"entry"` and `v = 1`;
- `exam`, `shift` and `cand` are strings;
- `attempt`, `keyEpoch`, `seq`, `tMonoMs` and `activeMs` are safe integers ≥ 0;
- `prev` and `bodyCommit` are 64 lowercase hex characters;
- `kind` is one of the kinds below.

**Chain rules:**

- `seq` starts at **1** and increases by exactly 1.
- The first entry's `prev` is `genesisPrev(ctx)`. Every later `prev` is the `h` of the previous entry, as hex.

**Kinds:** `unlock`, `answer`, `clear`, `mark`, `integrity`, `gap`, `handover`, `idle`, `submit`.

**States** (NTA question palette):

| State | Meaning | Evaluated |
|---|---|---|
| `NV` | not visited | no |
| `NA` | visited, not answered | no |
| `A` | answered | **yes** |
| `MR` | marked for review, no answer | no |
| `AMR` | answered and marked for review | **yes** |

NTA's evaluation rule: `A` and `AMR` are evaluated. `MR` has no answer and is not.

**Body** (`bodyFromArray`) must have exactly 5 elements and tag `"body"`. Its fields:

- `item`, `state` and `answer` are strings;
- `state` is `''` or one of the five states;
- `meta` is an array.

Conventions. The code does not check these in v1.

- Non-item entries (`unlock`, `integrity`, `gap`, `submit`, …) use `''` for `item`, `state` and `answer`.
- A `submit` body's meta is `[form, finalHash]`.

**Counts** (`counts(responses)`):

| Count | Definition |
|---|---|
| `attempted` | state ≠ `NV` |
| `answered` | state ∈ {`A`, `AMR`} |
| `marked` | state ∈ {`MR`, `AMR`} |

## 7. Signatures

- **Algorithm:** `ECDSA-P256-SHA256` over `m = 0x02 ‖ UTF-8(canon(header))`. The signature's internal digest is therefore `h`.
- **Encoding:** IEEE-P1363, 64 bytes (`r ‖ s`, 32 bytes each, big-endian).
- **Signing:** native `crypto.sign('sha256', m, {key, dsaEncoding:'ieee-p1363'})`, then normalised to **low-S**:
  - if `s > n/2`, replace `s` with `n − s`;
  - `n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551`.
  - Every signer output is low-S.
- **Verifying.** Both verifiers accept only 64-byte signatures, return `false` rather than throwing, and do **not** reject high-S.
  - Native: `crypto.verify('sha256', m, {key, dsaEncoding:'ieee-p1363'}, sig)`.
  - noble (browser-safe): `p256.verify(sig, m, pub, {prehash:true, lowS:false})`.
- **Signing is not deterministic.** Vectors check that signatures *verify* under both verifiers, never that bytes are equal. `signatures.items` holds 16 signed headers (seq 1–16) by `seats[0]` of `fixtures/keys.json`.

## 8. Body envelope

This seals a body to a cell. The relay sees only `bodyCommit` in the header and cannot read the answer.

```
envelope = ephPub(65) ‖ nonce(24) ‖ XChaCha20-Poly1305(key, nonce).encrypt(salt(16) ‖ UTF-8(canon(body)))
shared   = ECDH(ephPriv, cellPub)            -- the 32-byte x-coordinate
key      = HKDF-SHA256(ikm = shared, salt = none, info = UTF-8(canon(["saakshi-body",1,exam,shift,attempt,cand,seq])), L = 32)
```

- `ephPub` is a fresh 65-byte uncompressed P-256 key for every envelope. `nonce` is 24 random bytes. There is no AAD.
- "salt = none" means HKDF's RFC 5869 default: 32 zero bytes.
- The ciphertext carries a 16-byte Poly1305 tag. The minimum envelope length is 65 + 24 + 16 + 16 = 121 bytes.
- **Opening** (`openBody`):
  1. ECDH with the cell private key and the first 65 bytes.
  2. Decrypt.
  3. Split off the 16-byte salt.
  4. Decode the remainder as strict UTF-8, run `parseCanon`, then `bodyFromArray`.
  5. Require `bodyCommit(salt, body)` to equal the header's `bodyCommit`. Any failure throws.
- Vector: `bodyEnvelope` (seq 1, 173 bytes) opens with `cells[0].priv` to the §5 example body.

## 9. Custody

**Crockford-80 codes** (`crockford80`, `decodeCrockford80`). These are used for offline codes and receipt codes.

- Take the first 10 bytes (80 bits) as a big-endian integer `n`.
- Emit 16 symbols of 5 bits each, most significant first, from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
- Then emit one check symbol, `SYM[n mod 37]`, where `SYM = 0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U`. The last five symbols are for check values 32–36 only.
- Decoding normalises the input first:
  - uppercase;
  - drop `-`;
  - `O` → `0`;
  - `I` and `L` → `1`.
- It then requires exactly 17 symbols, the first 16 with values 0–31, and a matching check symbol. So a one-symbol typo is rejected.

**Offline code and wrap.** Codes are per centre and per shift: `newOfflineCode() = crockford80(random 10 bytes)`.

```
wrapKey = HKDF-SHA256(ikm = decodeCrockford80(code) (10 bytes), salt = none,
                      info = UTF-8(canon(["saakshi-offline",exam,shift,centre])), L = 32)
W_c     = nonce(24) ‖ XChaCha20-Poly1305(wrapKey, nonce).encrypt(kF1(32) ‖ kF2(32))   -- 104 bytes, no AAD
```

- The `saakshi-offline` info carries **no** version integer. The `saakshi-body` info does.
- Unwrapping yields `kF1` = plaintext[0..32) and `kF2` = plaintext[32..64).

**Shamir 2-of-3.**

- The secret is `kF1 ‖ kF2 ‖ L` (96 bytes; each key must be 32 bytes).
- It is split with `shamir-secret-sharing` `split(secret, 3, 2)`, over GF(2^8).
- Each share is **97 bytes**: 96 bytes of y-values, then 1 byte of x-coordinate.
- `combineBundle` needs at least 2 shares and requires a 96-byte result.

**Key commitment:** `kc_f = hex(SHA-256(0x07 ‖ K_f))`.

Vector: `custody` holds the code, the centre, `W_c`, `kc` for F1 and F2, `L` and three shares. Every pair of shares rebuilds the bundle.

## 10. Merkle log

This is the RFC 9162 §2.1 Merkle Tree Hash:

| Case | Hash |
|---|---|
| empty tree | `SHA-256("")` |
| leaf | `SHA-256(0x00 ‖ data)` |
| node | `SHA-256(0x01 ‖ left ‖ right)` |

- A tree of n ≥ 2 leaves splits at `k`, the largest power of two **strictly less than** n. No leaf is duplicated.
- The leaf `data` is `UTF-8(canon(leafArray(...)))` (§5).
- Inclusion and consistency proofs and their verifiers follow RFC 9162 §2.1.3 and §2.1.4.
  - A consistency proof for `size1 = size2` is empty.
  - `size1 < 1` or `size1 > size2` fails.
- Vector `merkle` contains:
  - 13 leaf hashes and the root of every prefix;
  - inclusion proofs for indices 0, 5 and 12 at size 13;
  - consistency proofs for (1,13), (4,13), (7,13) and (13,13).
  - `roots[12] = 5b84a7b11c6369338be22fcc4f88d2f5755bfd97f9b189930041d1ea06f1f165`.

## 11. Signed chain line

- One journal line per entry: `canon(["signed", headerArray, sigHex])`.
  - `sigHex` is 128 lowercase hex characters.
  - The file is these lines joined with `\n`, with a trailing `\n`. `chain.lines` in the vectors holds the lines without newlines.
- **Verifier** (`verifyChain(ctx, lines, verify)`). It walks the lines in order and returns the **first** bad line's index and fault. On success it returns `head` (the last `h`) and `count`. Per line, the check order is:

| # | Fault | Check |
|---|---|---|
| 1 | `parse` | `parseCanon` succeeds (strict canonical form) |
| 2 | `shape` | `["signed", array, 128-hex string]` and `headerFromArray` succeeds |
| 3 | `context` | `exam`, `shift`, `attempt` and `cand` equal the expected context |
| 4 | `sig` | `verify(0x02 ‖ UTF-8(canon(header)), sig)` |
| 5 | `seq` | `seq = index + 1` |
| 6 | `prev` | `prev` = the previous `h` (the genesis for the first line) |

- A flipped byte anywhere in a line is caught at that line.
- The verifier cannot see a **truncated** chain, which is still a valid prefix. Truncation is detected by comparing the chain head with the receipt's `h` and the Merkle leaf (Stage 2).
- Vector `chain.lines`: 5 entries (`unlock`, then 4 `answer`s) signed by `seats[0]`, `keyEpoch 1`. The first line:

```
["signed",["entry",1,"DEMO-2026","S1",1,"C0001",1,1,"5d69bc2c61786a76aca971f7b9dce3b2d12f9e592b92cc102720078d6564fd8a","unlock",0,0,"82c0ecf07a7ae0b0bd0cd6380e5af2160a554426253c2bede009e4cc2f2283c8"],"83184b69080e4621be726189d303d77bb3d1cfdffa8c9973584f9f89740c07926f3a2911dba71b23c8f063ffa27f07d8f8ba8688f2cd52c2db5de65e900fe312"]
```

## 12. Schemas

This is `fixtures/schemas/v1.json` (`version: 1`). `validateRow` rejects unexpected fields, missing fields and bad values.

The spec types:

| Spec | Meaning |
|---|---|
| `string` | a JSON string |
| `int` | a safe integer |
| `hex64` | 64 lowercase hex characters |
| `[...]` | one of the listed values |

**Cohort row** (one row per candidate × item):

| Field | Spec | Note |
|---|---|---|
| `cand` | string | |
| `centre` | string | |
| `shift` | string | |
| `form` | `F1` \| `F2` | |
| `lang` | `en` \| `hi` \| `ta` | |
| `pwd` | `0` \| `1` | |
| `item` | string | bank id (`I01`…), not the display number |
| `state` | `NV` \| `NA` \| `A` \| `MR` \| `AMR` | |
| `answer` | `""` \| `A` \| `B` \| `C` \| `D` | |
| `dwellMs` | int | |
| `visits` | int | |
| `changes` | int | |
| `tFirstMs` | int | ms from unlock to the first answer on this item; `-1` if never answered |

**Export fields.** A cell export row has every cohort field plus these. They describe the last entry touching the item.

| Field | Spec |
|---|---|
| `seq` | int |
| `rxWall` | int |
| `h` | hex64 |

## 13. Vectors and fixtures

| Path | Produced by | Contents |
|---|---|---|
| `fixtures/vectors/protocol-v1.json` | `tools/gen-vectors.ts` | the golden vectors for §2–§11 |
| `fixtures/keys.json` | `tools/gen-fixtures.ts` | demo keys: `authority`, `cells[3]`, `seats[8]` (published; demo only) |
| `fixtures/cohort-stub.jsonl` | `tools/gen-fixtures.ts` | 3 candidates × 20 items (mulberry32, seed 42) |
| `fixtures/paper/{bank,key,forms}.json` | hand-written | item bank, answer key, form orders |
| `fixtures/schemas/v1.json` | hand-written | §12 |

- The generators are run **once**. They refuse to overwrite an existing file; deleting a file to regenerate it counts as a protocol or fixture change.
- `packages/core/test/vectors.test.ts` checks the vectors under Node and Bun:
  - it recomputes every deterministic value exactly;
  - it verifies every signature and the chain under both the native and the noble verifier;
  - it opens the body envelope with `cells[0]`;
  - it unwraps the offline code;
  - it rebuilds the bundle from each pair of shares.
- The nonces, ephemeral keys, share polynomials and signatures in the vectors are random. They are checked by opening or verifying them, never by comparing bytes.
