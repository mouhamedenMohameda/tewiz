export type SampleStatus = 'collected' | 'validated' | 'rejected';

export interface Scenario {
  structure: string;
  noise: string;
  language: string;
  difficulty: string;
  zone: string;
}

export interface DatasetSample {
  id: string;
  collectorUserId: string;
  audioMime: string;
  audioDurationS: number | null;
  pickup: { poiId: number; label: string | null } | null;
  destination: { poiId: number; label: string | null } | null;
  isOpen: boolean;
  transcriptGold: string | null;
  scenario: Scenario;
  speaker: { gender: string | null; ageBand: string | null };
  status: SampleStatus;
  reviewNote: string | null;
  split: 'dev' | 'test' | null;
  createdAt: string;
}

export interface AxisBucket {
  value: string;
  count: number;
}

export interface Coverage {
  structure: AxisBucket[];
  noise: AxisBucket[];
  language: AxisBucket[];
  difficulty: AxisBucket[];
  zone: AxisBucket[];
  total: number;
}

export interface Tester {
  id: string;
  phone: string | null;
  fullName: string | null;
  samples: number;
  validated: number;
}

export interface PlaceCoverage {
  distinctPlaces: number;
  maxTimesUsed: number;
  singletons: number;
  top: { label: string; timesUsed: number }[];
}
