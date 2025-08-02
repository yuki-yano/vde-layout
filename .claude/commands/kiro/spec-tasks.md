---
description: Generate implementation tasks for a specification
allowed-tools: Bash, Read, Write, Edit, Update, MultiEdit
---

# Implementation Tasks

Generate detailed implementation tasks for feature: **$ARGUMENTS**

## Interactive Approval: Requirements & Design Review

**CRITICAL**: Tasks can only be generated after both requirements and design are reviewed and approved.

### Interactive Review Process
- Requirements document: @.kiro/specs/$ARGUMENTS/requirements.md
- Design document: @.kiro/specs/$ARGUMENTS/design.md
- Spec metadata: @.kiro/specs/$ARGUMENTS/spec.json

**Interactive Approval Process**:
1. **Check if documents exist** - Verify that requirements.md and design.md have been generated
2. **Prompt for requirements review** - Ask user: "requirements.mdをレビューしましたか？ [y/N]"
3. **Prompt for design review** - Ask user: "design.mdをレビューしましたか？ [y/N]"
4. **If both 'y' (yes)**: Automatically update spec.json to approve both phases and proceed with tasks generation
5. **If any 'N' (no)**: Stop execution and instruct user to review respective documents first

**Auto-approval update in spec.json when user confirms both reviews**:
```json
{
  "approvals": {
    "requirements": {
      "generated": true,
      "approved": true  // ← Automatically set to true when user confirms
    },
    "design": {
      "generated": true,
      "approved": true  // ← Automatically set to true when user confirms
    }
  },
  "phase": "design-approved"
}
```

**User Interaction Example**:
```
📋 Requirements and Design review required before generating tasks.
📄 Please review: .kiro/specs/feature-name/requirements.md
❓ requirements.mdをレビューしましたか？ [y/N]: y
📄 Please review: .kiro/specs/feature-name/design.md
❓ design.mdをレビューしましたか？ [y/N]: y
✅ Requirements and Design approved automatically. Proceeding with tasks generation...
```

## Context Analysis

### Complete Spec Context (APPROVED)
- Requirements: @.kiro/specs/$ARGUMENTS/requirements.md
- Design: @.kiro/specs/$ARGUMENTS/design.md
- Current tasks: @.kiro/specs/$ARGUMENTS/tasks.md
- Spec metadata: @.kiro/specs/$ARGUMENTS/spec.json

### Steering Context
- Architecture patterns: @.kiro/steering/structure.md
- Development practices: @.kiro/steering/tech.md
- Product constraints: @.kiro/steering/product.md

## Task: Generate Code-Generation Prompts

**Prerequisites Verified**: Both requirements and design are approved and ready for task breakdown.

**CRITICAL**: Convert the feature design into a series of prompts for a code-generation LLM that will implement each step in a test-driven manner. Prioritize best practices, incremental progress, and early testing, ensuring no big jumps in complexity at any stage.

Create implementation plan in the language specified in spec.json:

### 1. Code-Generation Tasks Structure
Create tasks.md in the language specified in spec.json (check `@.kiro/specs/$ARGUMENTS/spec.json` for "language" field):

```markdown
# Implementation Plan

- [ ] 1. Set up project structure and core interfaces
  - Create directory structure for models, services, repositories, and API components
  - Define interfaces that will be implemented in subsequent tasks
  - Set up testing framework for test-driven development
  - _Requirements: 1.1_

- [ ] 2. Implement data models with test-driven approach
- [ ] 2.1 Create base model functionality
  - Write tests for base model behavior first
  - Implement base Entity class to pass tests
  - Include common properties and validation methods
  - _Requirements: 2.1, 2.2_

- [ ] 2.2 Implement User model with validation
  - Write User model tests including validation edge cases
  - Create User class with email validation and password hashing
  - Test edge cases: invalid email, weak password, duplicate users
  - _Requirements: 1.2, 1.3_

- [ ] 2.3 Implement primary domain model with relationships
  - Write tests for [Domain] model including relationships
  - Code [Domain] class with relationship handling
  - Implement business logic and validation rules
  - _Requirements: 2.3, 2.4_

- [ ] 3. Create data access layer with test-driven approach
- [ ] 3.1 Implement database connection utilities
  - Write tests for database connection scenarios first
  - Implement connection utilities to pass the tests
  - Add error handling and connection pooling
  - _Requirements: 3.1_

- [ ] 3.2 Implement repository pattern for User data access
  - Write repository tests for CRUD operations first
  - Implement User repository with standard data operations
  - Test create, read, update, delete scenarios
  - _Requirements: 3.2, 3.3_

- [ ] 3.3 Implement domain-specific repository
  - Write tests for domain repository operations
  - Code [Domain]Repository with business-specific queries
  - Include relationship loading and filtering capabilities
  - _Requirements: 3.4_

- [ ] 4. Build API layer with test-first approach
- [ ] 4.1 Create authentication service and endpoints
  - Write API tests for authentication flows first
  - Build AuthService with login and registration methods
  - Implement JWT token generation and validation
  - Create auth endpoints with proper error handling
  - _Requirements: 4.1, 4.2_

- [ ] 4.2 Implement core API endpoints
  - Write API tests for domain operations first
  - Code [Domain]Service with business logic
  - Create REST endpoints with validation and error handling
  - Implement authentication middleware for protected routes
  - _Requirements: 4.3, 4.4_

- [ ] 5. Create frontend components with integrated testing
- [ ] 5.1 Build foundational UI components
  - Write component tests for UI elements first
  - Create reusable components (Button, Input, Form)
  - Test component rendering, props, and user interactions
  - _Requirements: 5.1_

- [ ] 5.2 Implement authentication components
  - Write tests for auth component behavior first
  - Code LoginForm and RegisterForm components
  - Implement API integration for authentication
  - Handle loading states and error messages
  - _Requirements: 5.2, 5.3_

- [ ] 5.3 Build main feature components
  - Write tests for domain component interactions
  - Implement [Domain]List and [Domain]Form components
  - Add API integration for data operations
  - Handle CRUD operations with proper feedback
  - _Requirements: 5.4, 5.5_

- [ ] 6. Wire all components together and verify integration
- [ ] 6.1 Create main application integration
  - Write integration tests for complete application flow
  - Implement application routing and navigation
  - Set up authentication guards for protected routes
  - Verify all components work together as designed
  - _Requirements: 6.1_

- [ ] 6.2 Implement automated end-to-end testing
  - Write E2E tests covering complete user workflows
  - Test authentication flow: register → login → logout
  - Test main feature workflows with CRUD operations
  - Verify complete system integration
  - _Requirements: 6.2_
```

**Code-Generation Prompt Format Rules**:
- Hierarchical numbering: Major phases (1, 2, 3) and sub-tasks (1.1, 1.2)
- Each task is a prompt for a code-generation LLM that will implement the step
- Specify what to create/modify but rely on design document for implementation details
- Build incrementally: each task explicitly references outputs from previous tasks
- Start with tests when appropriate (test-driven development)
- Each task explains how it connects to subsequent tasks
- End with specific requirement mapping: _Requirements: X.X, Y.Y_
- Focus ONLY on writing, modifying, or testing code
- Tasks should be completable in 1-3 hours each
- Final task must wire everything together to prevent orphaned code

### 2. Code-Generation Quality Guidelines
- **Prompt Optimization**: Each task is a clear prompt that a coding agent can execute
- **Progressive Building**: Explicitly state which previous task outputs are used
- **Test-First Approach**: Write tests before implementation when appropriate
- **Forward References**: Explain how current task output will be used later
- **Requirements Traceability**: Map to specific EARS requirements from requirements.md
- **Integration Focus**: Final tasks must wire all components together
- **Coding-Only Focus**: Exclude deployment, user testing, or non-coding activities
- **Design Document Reliance**: Tasks reference design for implementation details

### 3. Mandatory Task Categories (Coding Only)
Include ONLY coding tasks for:
- **Data Models**: Model classes with validation and tests
- **Data Access**: Repository pattern implementation with tests
- **API Services**: Backend service implementation with API tests
- **UI Components**: Frontend component development with component tests
- **Integration**: Code integration and automated testing
- **End-to-End Testing**: Automated test implementation

**EXCLUDED (Non-Coding Tasks):**
- User acceptance testing or user feedback gathering
- Production deployment or staging environments
- Performance metrics gathering or analysis
- CI/CD pipeline setup or configuration
- Documentation creation (beyond code comments)

### 4. Granular Requirements Mapping
For each task, reference specific EARS requirements from requirements.md:
- Reference granular sub-requirements, not just user stories
- Map to specific acceptance criteria (e.g., REQ-2.1.3: IF validation fails THEN...)
- Ensure every EARS requirement is covered by implementation tasks
- Use format: _Requirements: 2.1, 3.3, 1.2_ (refer to numbered requirements)


### 6. Document Generation Only
Generate the tasks document content ONLY. Do not include any review or approval instructions in the actual document file.

### 7. Update Metadata

Update spec.json with:
```json
{
  "phase": "tasks-generated",
  "approvals": {
    "requirements": {
      "generated": true,
      "approved": true
    },
    "design": {
      "generated": true,
      "approved": true
    },
    "tasks": {
      "generated": true,
      "approved": false
    }
  },
  "updated_at": "current_timestamp"
}
```

### 8. Metadata Update
Update the tracking metadata to reflect task generation completion.

---

## INTERACTIVE APPROVAL IMPLEMENTED (Not included in document)

The following is for Claude Code conversation only - NOT for the generated document:

### Interactive Approval Process
This command now implements interactive approval for the final phase:

1. **Requirements & Design Review Prompts**: Automatically prompts user to confirm both documents are reviewed
2. **Auto-approval**: Updates spec.json automatically when user confirms both with 'y'
3. **Tasks Generation**: Proceeds immediately after dual approval
4. **Ready for Implementation**: Tasks are generated and spec is ready for implementation phase

### Tasks Review for Implementation Phase
After generating tasks.md, the implementation phase is ready to begin.

**Final approval process for implementation**:
```
📋 Tasks review completed. Ready for implementation.
📄 Generated: .kiro/specs/feature-name/tasks.md
✅ All phases approved. Implementation can now begin.
```

### Review Checklist (for user reference):
- [ ] Tasks are properly sized (2-4 hours each)
- [ ] All requirements are covered by tasks
- [ ] Task dependencies are correct
- [ ] Technology choices match the design
- [ ] Testing tasks are included

## Instructions

1. **Check spec.json for language** - Use the language specified in the metadata
2. **Convert design into code-generation prompts** - Each task must be a specific coding instruction
3. **Apply test-driven approach** - Integrate testing into each development task
4. **Specify exact files and components** - Define what code to write/modify in which files
5. **Build incrementally** - Each task uses outputs from previous tasks, no orphaned code
6. **Map to granular requirements** - Reference specific EARS acceptance criteria
7. **Focus on coding only** - Exclude deployment, user testing, performance analysis
8. **Order by dependencies** - Ensure logical build sequence
9. **Update tracking metadata** upon completion

Generate code-generation prompts that provide step-by-step implementation instructions for a coding agent.
ultrathink