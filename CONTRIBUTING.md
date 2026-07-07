# Contributing to Tollgate

Thank you for your interest in contributing to Tollgate! Here's how you can help.

## Getting Started

1. Fork the repository on GitHub.
2. Clone your forked repository locally.
3. Install dependencies:
   ```bash
   pnpm install
   cargo build --workspace
   ```
4. Set up your environment variables by copying `.env.example` to `.env` and filling in the necessary values.

## Development Workflow

1. **Open an issue**: Before making large changes, please open an issue describing what you want to do. This helps us discuss the approach and ensures your work aligns with the project's goals.

2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**: Follow the existing code style and conventions.

4. **Run lint and tests**:
   ```bash
   pnpm run lint
   pnpm run test
   cargo test --workspace
   ```

5. **Commit your changes**: Use conventional commit messages:
   ```
   feat: add new feature
   fix: resolve a bug
   docs: update documentation
   refactor: improve code structure without changing functionality
   test: add or update tests
   chore: update dependencies, configs, etc.
   ```

6. **Push your branch**:
   ```bash
   git push origin feature/your-feature-name
   ```

7. **Open a Pull Request**: Describe your changes and link to any relevant issues.

## Pull Request Guidelines

- Keep PRs focused on a single feature or fix.
- Write clear, concise commit messages.
- Include tests for new functionality where applicable.
- Ensure all existing tests pass.
- Update documentation as needed.

## Code of Conduct

We expect all contributors to be respectful and inclusive. Please follow our code of conduct (to be added in a future update).

## License

By contributing to Tollgate, you agree that your contributions will be licensed under the MIT License.
