import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RefreshAnalysis } from '@/components/refresh-analysis';

/**
 * The server action is mocked rather than imported for real.
 *
 * `@/app/actions` pulls in the analysis container, which is `server-only` and
 * throws by design when loaded outside a server environment. What is under test
 * here is the control's states, not the action — the action's own behaviour is
 * covered by the E2E refresh case.
 */
const { refreshAnalysis } = vi.hoisted(() => ({ refreshAnalysis: vi.fn() }));

vi.mock('@/app/actions', () => ({ refreshAnalysis }));

describe('RefreshAnalysis', () => {
  beforeEach(() => {
    refreshAnalysis.mockReset();
  });

  it('offers a submit button in a form that posts to the action', () => {
    // A real form, so it still works before hydration and without JavaScript.
    const { container } = render(<RefreshAnalysis repository="acme/toolkit" />);

    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('type', 'submit');
    expect(container.querySelector('form')).not.toBeNull();
  });

  it('submits the repository so the action can validate it itself', () => {
    // Rather than the action trusting the referring URL.
    const { container } = render(<RefreshAnalysis repository="acme/toolkit" />);

    const hidden = container.querySelector('input[type="hidden"]');
    expect(hidden).toHaveAttribute('name', 'repository');
    expect(hidden).toHaveValue('acme/toolkit');
  });

  it('exposes a live region before it has anything to say', () => {
    // A region inserted at the same time as its text is not reliably announced.
    render(<RefreshAnalysis repository="acme/toolkit" />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('');
  });

  it('reports its busy state while the refresh runs', async () => {
    // Held open so the pending state is observable, then settled before the
    // test ends — a promise left unresolved keeps React's action queue busy
    // and the next test never leaves its pending state.
    let settle: (state: { error?: string }) => void = () => {};
    refreshAnalysis.mockImplementation(
      () =>
        new Promise<{ error?: string }>((resolve) => {
          settle = resolve;
        }),
    );

    const user = userEvent.setup();
    const { container } = render(<RefreshAnalysis repository="acme/toolkit" />);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    });
    expect(container.querySelector('form')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing the analysis…');

    settle({});
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    });
    expect(container.querySelector('form')).toHaveAttribute('aria-busy', 'false');
  });

  it('explains when to try again once the refresh limit is reached', async () => {
    // Exceeding the limit has to say when, not fail silently.
    refreshAnalysis.mockResolvedValue({
      error: 'Refresh limit reached. Try again in 3 minutes.',
    });

    const user = userEvent.setup();
    render(<RefreshAnalysis repository="acme/toolkit" />);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Refresh limit reached. Try again in 3 minutes.',
      );
    });
  });

  it('wires the message to the button so it is not just floating text', async () => {
    refreshAnalysis.mockResolvedValue({ error: 'Refresh limit reached.' });

    const user = userEvent.setup();
    render(<RefreshAnalysis repository="acme/toolkit" />);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute(
        'aria-describedby',
        screen.getByRole('status').id,
      );
    });
  });

  it('returns to an idle, operable button after a successful refresh', async () => {
    refreshAnalysis.mockResolvedValue({});

    const user = userEvent.setup();
    render(<RefreshAnalysis repository="acme/toolkit" />);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('is reachable and operable from the keyboard alone', async () => {
    // A native submit button, so this is free — the test guards against it
    // being replaced with something that is not.
    refreshAnalysis.mockResolvedValue({});

    const user = userEvent.setup();
    render(<RefreshAnalysis repository="acme/toolkit" />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(refreshAnalysis).toHaveBeenCalledTimes(1));
  });
});
