export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "acked" | "resolved";

export interface Incident {
  id: string;
  title: string;
  description: string;
  details?: string;
  affectedServices: string[];
  severity: IncidentSeverity;
  ownerTeam: string;
  assignee?: string;
  status: IncidentStatus;
  createdAt: string;
  ackedAt?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  idempotencyKey?: string;
}

export interface OpenIncidentInput {
  title: string;
  description: string;
  details?: string;
  affectedServices: string[];
  severity: IncidentSeverity;
  ownerTeam: string;
  idempotencyKey?: string;
}

export interface ListIncidentsFilter {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  assignee?: string;
}

/** Only what the tools need, nothing they don't. */
export interface OnCallBackend {
  findByIdempotencyKey(key: string): Incident | undefined;
  create(input: OpenIncidentInput): Incident;
  get(id: string): Incident | undefined;
  list(filter: ListIncidentsFilter): Incident[];
  save(incident: Incident): void;
}

export class InMemoryOnCallBackend implements OnCallBackend {
  private incidents = new Map<string, Incident>();
  private nextId = 1;

  findByIdempotencyKey(key: string): Incident | undefined {
    return [...this.incidents.values()].find((i) => i.idempotencyKey === key);
  }

  create(input: OpenIncidentInput): Incident {
    const incident: Incident = {
      id: `INC-${this.nextId++}`,
      title: input.title,
      description: input.description,
      details: input.details,
      affectedServices: input.affectedServices,
      severity: input.severity,
      ownerTeam: input.ownerTeam,
      status: "open",
      createdAt: new Date().toISOString(),
      idempotencyKey: input.idempotencyKey,
    };
    this.incidents.set(incident.id, incident);
    return incident;
  }

  get(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  list(filter: ListIncidentsFilter): Incident[] {
    return [...this.incidents.values()].filter(
      (i) =>
        (filter.status === undefined || i.status === filter.status) &&
        (filter.severity === undefined || i.severity === filter.severity) &&
        (filter.assignee === undefined || i.assignee === filter.assignee),
    );
  }

  save(incident: Incident): void {
    this.incidents.set(incident.id, incident);
  }
}
