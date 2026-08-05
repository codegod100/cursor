const tripsBody = document.getElementById("trips-body");
const tripsStatus = document.getElementById("trips-status");
const statsCards = document.getElementById("stats-cards");
const statsForm = document.getElementById("stats-form");
const refreshButton = document.getElementById("refresh-trips");

const paymentLabels = {
  1: "Credit card",
  2: "Cash",
  3: "No charge",
  4: "Dispute",
  5: "Unknown",
  6: "Voided",
};

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function showTripsError(message) {
  tripsStatus.hidden = false;
  tripsStatus.textContent = message;
  tripsBody.innerHTML = `<tr><td colspan="5" class="error-cell">${message}</td></tr>`;
}

async function loadTrips() {
  tripsStatus.hidden = true;
  tripsBody.innerHTML =
    '<tr><td colspan="5" class="loading-cell">Loading trips from MotherDuck…</td></tr>';

  try {
    const response = await fetch("/api/trips");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }

    if (!payload.trips?.length) {
      tripsBody.innerHTML =
        '<tr><td colspan="5" class="empty-cell">No trips returned for this query.</td></tr>';
      return;
    }

    tripsBody.innerHTML = payload.trips
      .map(
        (trip) => `
        <tr>
          <td>${formatDateTime(trip.tpep_pickup_datetime)}</td>
          <td>${trip.passenger_count ?? "—"}</td>
          <td>${trip.trip_distance ?? "—"}</td>
          <td>${formatCurrency(trip.fare_amount ?? 0)}</td>
          <td>${paymentLabels[trip.payment_type] ?? trip.payment_type ?? "—"}</td>
        </tr>
      `
      )
      .join("");
  } catch (error) {
    showTripsError(error.message || "Could not load trips.");
  }
}

function renderStats(data) {
  statsCards.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Trips</span>
      <span class="stat-value">${formatNumber(data.trip_count)}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Passengers</span>
      <span class="stat-value">${formatNumber(data.total_passengers)}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Total fare</span>
      <span class="stat-value">${formatCurrency(data.total_fare)}</span>
    </div>
  `;
}

async function loadStats(start, end) {
  statsCards.innerHTML =
    '<div class="stat-card placeholder">Running aggregate query…</div>';

  try {
    const params = new URLSearchParams({ start, end });
    const response = await fetch(`/api/stats?${params}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }

    renderStats(payload);
  } catch (error) {
    statsCards.innerHTML = `<div class="stat-card placeholder">${error.message}</div>`;
  }
}

statsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(statsForm);
  loadStats(formData.get("start"), formData.get("end"));
});

refreshButton.addEventListener("click", loadTrips);

loadTrips();
loadStats("2022-11-01", "2022-12-01");
