package main

import "testing"

func TestOffboardingInputContract(t *testing.T) {
	input := "export interface OffboardingRequest {\n  date: Date | string;\n  notes: string;\n  recipient: string;\n  value?: number | null;\n}\nexport interface Other {\n  date: Date | string;\n  notes: string;\n}\n"
	want := "export interface OffboardingRequest {\n  date: string;\n  notes?: string;\n  recipient?: string;\n  value?: number | null;\n}\nexport interface Other {\n  date: Date | string;\n  notes: string;\n}\n"
	if got := offboardingInputContract(input); got != want {
		t.Fatalf("unexpected contract: %s", got)
	}
	if got := offboardingInputContract(want); got != want {
		t.Fatalf("not idempotent: %s", got)
	}
}
