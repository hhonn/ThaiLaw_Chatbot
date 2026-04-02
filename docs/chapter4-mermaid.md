# Chapter 4 Technical Diagrams (Mermaid)

## Figure 4.1 Data Pipeline

```mermaid
flowchart LR
    A[Legal Data Sources] --> B[Normalize and Clean]
    B --> C[Unified Dataset]
    C --> D[Chunk and Metadata Builder]
    D --> E[Embedding Generator]
    D --> F[BM25 Corpus Builder]
    E --> G[Vector Index]
    F --> H[Sparse Index]

    I[User Query] --> J[Query Rewrite and Expansion]
    J --> K[Hybrid Retrieval]
    G --> K
    H --> K
    K --> L[RRF Fusion and Rerank]
    L --> M[Context Compression]
    M --> N[LLM Response Generation]
    N --> O[Answer with Inline Citations]
    O --> P[Analytics Event Logging]
```

## Figure 4.2 Dataset Schema

```mermaid
erDiagram
    LEGAL_DOCUMENT {
        string law
        string section
        string text
        string url
        string source
        string publish_date
        string category_hint
        string law_code
        string timeline_code
        boolean is_latest
    }

    ANALYTICS_EVENT {
        int id
        int ts
        string event_type
        string user_hash
        string session_id
        string topic
        int message_length
        string metadata_json
    }
```

## Figure 4.3 Feature Flow

```mermaid
flowchart TB
    Q[Raw Query and History] --> R[Query Rewriter]
    R --> X[Query Expansion]
    X --> B1[BM25 Retriever]
    X --> B2[Vector Retriever]
    B1 --> F[RRF Fusion]
    B2 --> F
    F --> C[Cross-Encoder Reranker]
    C --> D[Top-k Context Selector]
    D --> E[Context Compression]
    E --> G[LLM Generator]
    G --> H[Answer plus Citations plus Domain plus Risk]
```

## Figure 4.4 Model Workflow

```mermaid
sequenceDiagram
    participant U as User
    participant API as Backend API
    participant RET as Hybrid Retriever
    participant RR as Reranker
    participant LLM as Language Model

    U->>API: Submit question
    API->>API: Rewrite and expand query
    API->>RET: Retrieve candidate documents
    RET-->>API: BM25 and Vector candidates
    API->>RR: Re-rank candidates
    RR-->>API: Top-ranked contexts
    API->>LLM: Generate answer with context
    LLM-->>API: Streamed answer chunks
    API-->>U: Answer plus inline citations plus metadata
```

## Figure 4.5 Experiment Design

```mermaid
flowchart LR
    A[Benchmark Question Set] --> B1[Vector Only]
    A --> B2[BM25 Only]
    A --> B3[Hybrid no Rerank]
    A --> B4[Hybrid plus Rerank]
    A --> B5[Full Pipeline]

    B1 --> C[Metric Aggregator]
    B2 --> C
    B3 --> C
    B4 --> C
    B5 --> C

    C --> D[Quality and Latency Report]
    D --> E[Best Configuration Selection]
```

## Figure 4.6 Training and Validation Flow

```mermaid
flowchart TB
    A[Real User Events] --> B[Anonymize and Redact]
    B --> C[Real-only Filtering]
    C --> D[Dataset Builder]
    D --> E1[Questions Set]
    D --> E2[QA Pairs Set]
    D --> E3[Instruction Set]
    E1 --> F[Split Train Val Test]
    E2 --> F
    E3 --> F
    F --> G[Training or Prompt Tuning]
    F --> H[Validation]
    H --> I{Pass Gate?}
    I -->|Yes| J[Deploy]
    I -->|No| K[Revise Pipeline]
```

## Figure 4.7 Result Comparison Design

```mermaid
flowchart TB
    A[Candidate Systems] --> B[Offline Evaluation]
    B --> C1[Retrieval Metrics]
    B --> C2[Citation Metrics]
    B --> C3[Latency Metrics]
    B --> C4[Human Review]
    C1 --> D[Comparison Matrix]
    C2 --> D
    C3 --> D
    C4 --> D
    D --> E[Decision: Keep or Improve or Reject]
```
