import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient.js';

export default function TicketView() {
  const { shareToken } = useParams();
  const [ticket, setTicket] = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get(`/api/sessions/${shareToken}/ticket`)
      .then((data) => !cancelled && setTicket(data.ticket))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  if (error) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <p style={{ color: 'crimson' }}>{error}</p>
      </div>
    );
  }
  if (ticket === undefined) {
    return <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>Loading…</div>;
  }
  if (ticket === null) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <p>No ticket has been booked for this session yet.</p>
        <Link to={`/s/${shareToken}/consensus`}>← Back</Link>
      </div>
    );
  }

  const { booking_details: details, total_amount: total, payment_state: paymentState } = ticket;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480 }}>
      <h1>🎟️ Booked!</h1>
      <p>
        <strong>{details.movie}</strong>
      </p>
      <p>
        {details.cinema} — {details.date} {details.time}
      </p>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem' }}>
        <dt>Seats</dt>
        <dd>{Array.isArray(details.seats) ? details.seats.join(', ') : details.seats}</dd>
        <dt>Total</dt>
        <dd>{total != null ? `₹${total}` : 'Unknown'}</dd>
        <dt>Payment</dt>
        <dd>{paymentState}</dd>
        {details.upiQrVisible != null && (
          <>
            <dt>UPI QR shown</dt>
            <dd>{details.upiQrVisible ? 'Yes — scan in the automation browser to pay' : 'No'}</dd>
          </>
        )}
      </dl>
      <p style={{ color: '#666', fontSize: '0.85rem' }}>
        This ticket is visible to everyone in the group.
      </p>
    </div>
  );
}
