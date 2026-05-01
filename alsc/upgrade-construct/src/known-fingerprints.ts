import type { ConstructVersionFingerprint } from "./types.ts";

export const DISPATCHER_KNOWN_VENDOR_FINGERPRINTS: ConstructVersionFingerprint[] = [
  {
    version: 11,
    hashes: {
      VERSION: "0161495ed3eea0585c9b8458b53a776171df84675d3601ca46793c4849348778",
      "package.json": "d4dc20ca1ebb120e8e6a3def8c7d2bff5f8dfcb77ec427e7c253876c37a5c5b9",
      "tsconfig.json": "87009d314114d610d94a92724cc20c1c61db50ee3ebe909806bd5a82bd3eea6c",
      src: "01324d2b9be6284e63f6f5c7f02af5886d719c3b78b143e5ba5d68b3ad8e5e30",
    },
  },
  {
    version: 12,
    hashes: {
      VERSION: "132575a6ac64ce3b388e18406c474eba007690435d6e4df050b08921e04a571f",
      "construct.json": "4e945b020ef26791b0b6262f26fb01dbf7623019d4b70204adccd3dbe72d6bc6",
      "package.json": "d4dc20ca1ebb120e8e6a3def8c7d2bff5f8dfcb77ec427e7c253876c37a5c5b9",
      "tsconfig.json": "87009d314114d610d94a92724cc20c1c61db50ee3ebe909806bd5a82bd3eea6c",
      migrations: "6b8ba2860723dc4ccb4b8d729b9dabb7d4a18e6e138363924d902e4b0e662b84",
      src: "67dae5d24149b6f5bd8f7aa8de7f545fc059ce6b0c0931d2de5f1768d3087c37",
    },
  },
];
