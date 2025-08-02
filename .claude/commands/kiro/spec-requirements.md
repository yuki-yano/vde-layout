---
description: Generate comprehensive requirements for a specification
allowed-tools: Bash, Read, Write, Edit, MultiEdit, Update, WebSearch, WebFetch
---

# Requirements Generation

Generate comprehensive requirements for feature: **$ARGUMENTS**

## Context Validation

### Steering Context
- Architecture context: @.kiro/steering/structure.md
- Technical constraints: @.kiro/steering/tech.md
- Product context: @.kiro/steering/product.md

### Existing Spec Context
- Current spec directory: !`ls -la .kiro/specs/$ARGUMENTS/`
- Current requirements: @.kiro/specs/$ARGUMENTS/requirements.md
- Spec metadata: @.kiro/specs/$ARGUMENTS/spec.json

## Task: Generate Initial Requirements

Generate an initial set of requirements in EARS format based on the feature idea, then iterate with the user to refine them until they are complete and accurate.

Don't focus on code exploration in this phase. Instead, just focus on writing requirements which will later be turned into a design.

### Requirements Generation Guidelines
1. **Focus on Core Functionality**: Start with the essential features from the user's idea
2. **Use EARS Format**: All acceptance criteria must use proper EARS syntax
3. **No Sequential Questions**: Generate initial version first, then iterate based on user feedback
4. **Keep It Manageable**: Create a solid foundation that can be expanded through user review

### 1. EARS Format Requirements

**EARS (Easy Approach to Requirements Syntax)** is the mandatory format for acceptance criteria:

**Primary EARS Patterns:**
- **WHEN** [event/condition] **THEN** [system] **SHALL** [response]
- **IF** [precondition/state] **THEN** [system] **SHALL** [response]
- **WHILE** [ongoing condition] **THE SYSTEM SHALL** [continuous behavior]
- **WHERE** [location/context] **THE SYSTEM SHALL** [contextual behavior]

**Combined Patterns:**
- **WHEN** [event] **AND** [additional condition] **THEN** [system] **SHALL** [response]
- **IF** [condition] **AND** [additional condition] **THEN** [system] **SHALL** [response]

### 2. Requirements Hierarchy and Granularity

**Structure Requirements with Clear Hierarchy:**

```
# Requirements Document
├── Introduction (feature overview)
├── Requirements
│   ├── Requirement 1 (Major Feature Area)
│   │   ├── User Story (high-level need)
│   │   └── Acceptance Criteria (detailed EARS)
│   │       ├── Happy path scenarios
│   │       ├── Edge cases and error conditions
│   │       ├── User experience considerations
│   │       └── Technical constraints
│   ├── Requirement 2 (Next Feature Area)
│   └── ...
```

**Granularity Guidelines:**
- **High-level Requirements**: Major functional areas from the feature idea
- **User Stories**: Specific user needs within each requirement area  
- **Acceptance Criteria**: Testable conditions using EARS format

### 3. Requirements Document Structure
Generate requirements.md in the language specified in spec.json (check `@.kiro/specs/$ARGUMENTS/spec.json` for "language" field):

```markdown
# Requirements Document

## Introduction
[Clear introduction summarizing the feature and its business value]

## Requirements

### Requirement 1: [Major Feature Area]
**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria
This section should have EARS requirements

1. WHEN [event] THEN [system] SHALL [response]
2. IF [precondition] THEN [system] SHALL [response]
3. WHILE [ongoing condition] THE SYSTEM SHALL [continuous behavior]
4. WHERE [location/context] THE SYSTEM SHALL [contextual behavior]

### Requirement 2: [Next Major Feature Area]
**User Story:** As a [role], I want [feature], so that [benefit]

1. WHEN [event] THEN [system] SHALL [response]
2. WHEN [event] AND [condition] THEN [system] SHALL [response]

### Requirement 3: [Additional Major Areas]
[Continue pattern for all major functional areas]
```

### 4. Update Metadata
Update spec.json with:
```json
{
  "phase": "requirements-generated",
  "approvals": {
    "requirements": {
      "generated": true,
      "approved": false
    }
  },
  "updated_at": "current_timestamp"
}
```

### 5. Document Generation Only
Generate the requirements document content ONLY. Do not include any review or approval instructions in the actual document file.

---

## INTERACTIVE APPROVAL AVAILABLE (Not included in document)

The following is for Claude Code conversation only - NOT for the generated document:

### Next Phase Uses Interactive Approval
After generating requirements.md, the next phase (`/spec-design $ARGUMENTS`) will use interactive approval:

**Next interaction will be**:
```
/spec-design feature-name
# → "requirements.mdをレビューしましたか？ [y/N]"
# → If 'y': Auto-approval + design generation
# → If 'N': Stop and request review first
```

### Benefits of Interactive Approval
1. **Streamlined workflow**: No manual spec.json editing required
2. **Review enforcement**: Still requires human confirmation of review
3. **Immediate progression**: Approved phases proceed automatically
4. **Safety maintained**: 'N' response stops execution for proper review

### Review Checklist (for user reference):
- [ ] Requirements are clear and complete
- [ ] User stories cover all necessary functionality
- [ ] Acceptance criteria are testable
- [ ] Requirements align with project goals

### Traditional Manual Approval Still Available
If needed, you can still manually approve by updating `.kiro/specs/$ARGUMENTS/spec.json`:
```json
{
  "approvals": {
    "requirements": {
      "generated": true,
      "approved": true
    }
  },
  "phase": "requirements-approved"
}
```

**Recommended**: Use the interactive approval in `/spec-design $ARGUMENTS` for better user experience.

## Instructions

1. **Check spec.json for language** - Use the language specified in the metadata
2. **Generate initial requirements** based on the feature idea WITHOUT asking sequential questions first
3. **Apply EARS format** - Use proper EARS syntax patterns for all acceptance criteria
4. **Focus on core functionality** - Start with essential features and user workflows
5. **Structure clearly** - Group related functionality into logical requirement areas
6. **Make requirements testable** - Each acceptance criterion should be verifiable
7. **Update tracking metadata** upon completion

Generate requirements that provide a solid foundation for the design phase, focusing on the core functionality from the feature idea.