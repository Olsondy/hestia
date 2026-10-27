/** Values are server-owned. C01 exposes reads; task charging is implemented separately. */
export type CreditEntry = { id: string; kind: string; amount: number; createdAt: string };
export type CreditsView = { balance: { available: number; reserved: number }; entries: CreditEntry[] };
