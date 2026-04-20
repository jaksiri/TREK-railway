"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTools = registerTools;
const zod_1 = require("zod");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const database_1 = require("../db/database");
const websocket_1 = require("../websocket");
const MS_PER_DAY = 86400000;
const MAX_TRIP_DAYS = 90;
function isDemoUser(userId) {
    if (process.env.DEMO_MODE !== 'true')
        return false;
    const user = database_1.db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    return user?.email === 'demo@nomad.app';
}
function demoDenied() {
    return { content: [{ type: 'text', text: 'Write operations are disabled in demo mode.' }], isError: true };
}
function noAccess() {
    return { content: [{ type: 'text', text: 'Trip not found or access denied.' }], isError: true };
}
function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
/** Create days for a newly created trip (fresh insert, no existing days). */
function createDaysForNewTrip(tripId, startDate, endDate) {
    const insert = database_1.db.prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, ?, ?)');
    if (startDate && endDate) {
        const [sy, sm, sd] = startDate.split('-').map(Number);
        const [ey, em, ed] = endDate.split('-').map(Number);
        const startMs = Date.UTC(sy, sm - 1, sd);
        const endMs = Date.UTC(ey, em - 1, ed);
        const numDays = Math.min(Math.floor((endMs - startMs) / MS_PER_DAY) + 1, MAX_TRIP_DAYS);
        for (let i = 0; i < numDays; i++) {
            const d = new Date(startMs + i * MS_PER_DAY);
            const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            insert.run(tripId, i + 1, date);
        }
    }
    else {
        for (let i = 0; i < 7; i++)
            insert.run(tripId, i + 1, null);
    }
}
function registerTools(server, userId) {
    // --- TRIPS ---
    server.registerTool('create_trip', {
        description: 'Create a new trip. Returns the created trip with its generated days.',
        inputSchema: {
            title: zod_1.z.string().min(1).max(200).describe('Trip title'),
            description: zod_1.z.string().max(2000).optional().describe('Trip description'),
            start_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Start date (YYYY-MM-DD)'),
            end_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date (YYYY-MM-DD)'),
            currency: zod_1.z.string().length(3).optional().describe('Currency code (e.g. EUR, USD)'),
        },
    }, async ({ title, description, start_date, end_date, currency }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (start_date) {
            const d = new Date(start_date + 'T00:00:00Z');
            if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== start_date)
                return { content: [{ type: 'text', text: 'start_date is not a valid calendar date.' }], isError: true };
        }
        if (end_date) {
            const d = new Date(end_date + 'T00:00:00Z');
            if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== end_date)
                return { content: [{ type: 'text', text: 'end_date is not a valid calendar date.' }], isError: true };
        }
        if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
            return { content: [{ type: 'text', text: 'End date must be after start date.' }], isError: true };
        }
        const trip = database_1.db.transaction(() => {
            const result = database_1.db.prepare('INSERT INTO trips (user_id, title, description, start_date, end_date, currency) VALUES (?, ?, ?, ?, ?, ?)').run(userId, title, description || null, start_date || null, end_date || null, currency || 'EUR');
            const tripId = result.lastInsertRowid;
            createDaysForNewTrip(tripId, start_date || null, end_date || null);
            return database_1.db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
        })();
        return ok({ trip });
    });
    server.registerTool('update_trip', {
        description: 'Update an existing trip\'s details.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            title: zod_1.z.string().min(1).max(200).optional(),
            description: zod_1.z.string().max(2000).optional(),
            start_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            end_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            currency: zod_1.z.string().length(3).optional(),
        },
    }, async ({ tripId, title, description, start_date, end_date, currency }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        if (start_date) {
            const d = new Date(start_date + 'T00:00:00Z');
            if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== start_date)
                return { content: [{ type: 'text', text: 'start_date is not a valid calendar date.' }], isError: true };
        }
        if (end_date) {
            const d = new Date(end_date + 'T00:00:00Z');
            if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== end_date)
                return { content: [{ type: 'text', text: 'end_date is not a valid calendar date.' }], isError: true };
        }
        const existing = database_1.db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
        if (!existing)
            return noAccess();
        database_1.db.prepare('UPDATE trips SET title = ?, description = ?, start_date = ?, end_date = ?, currency = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title ?? existing.title, description !== undefined ? description : existing.description, start_date !== undefined ? start_date : existing.start_date, end_date !== undefined ? end_date : existing.end_date, currency ?? existing.currency, tripId);
        const updated = database_1.db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
        (0, websocket_1.broadcast)(tripId, 'trip:updated', { trip: updated });
        return ok({ trip: updated });
    });
    server.registerTool('delete_trip', {
        description: 'Delete a trip. Only the trip owner can delete it.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
        },
    }, async ({ tripId }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.isOwner)(tripId, userId))
            return noAccess();
        database_1.db.prepare('DELETE FROM trips WHERE id = ?').run(tripId);
        return ok({ success: true, tripId });
    });
    server.registerTool('list_trips', {
        description: 'List all trips the current user owns or is a member of. Use this for trip discovery before calling get_trip_summary.',
        inputSchema: {
            include_archived: zod_1.z.boolean().optional().describe('Include archived trips (default false)'),
        },
    }, async ({ include_archived }) => {
        const trips = database_1.db.prepare(`
        SELECT t.*, u.username as owner_username,
          (SELECT COUNT(*) FROM days d WHERE d.trip_id = t.id) as day_count,
          (SELECT COUNT(*) FROM places p WHERE p.trip_id = t.id) as place_count,
          CASE WHEN t.user_id = ? THEN 1 ELSE 0 END as is_owner
        FROM trips t
        JOIN users u ON u.id = t.user_id
        LEFT JOIN trip_members tm ON tm.trip_id = t.id AND tm.user_id = ?
        WHERE (t.user_id = ? OR tm.user_id IS NOT NULL)
          AND (? = 1 OR t.is_archived = 0)
        ORDER BY t.updated_at DESC
      `).all(userId, userId, userId, include_archived ? 1 : 0);
        return ok({ trips });
    });
    // --- PLACES ---
    server.registerTool('create_place', {
        description: 'Add a new place/POI to a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().min(1).max(200),
            description: zod_1.z.string().max(2000).optional(),
            lat: zod_1.z.number().optional(),
            lng: zod_1.z.number().optional(),
            address: zod_1.z.string().max(500).optional(),
            category_id: zod_1.z.number().int().positive().optional(),
            notes: zod_1.z.string().max(2000).optional(),
            website: zod_1.z.string().max(500).optional(),
            phone: zod_1.z.string().max(50).optional(),
        },
    }, async ({ tripId, name, description, lat, lng, address, category_id, notes, website, phone }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const result = database_1.db.prepare(`
        INSERT INTO places (trip_id, name, description, lat, lng, address, category_id, notes, website, phone, transport_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(tripId, name, description || null, lat ?? null, lng ?? null, address || null, category_id || null, notes || null, website || null, phone || null, 'walking');
        const place = database_1.db.prepare('SELECT * FROM places WHERE id = ?').get(result.lastInsertRowid);
        (0, websocket_1.broadcast)(tripId, 'place:created', { place });
        return ok({ place });
    });
    server.registerTool('update_place', {
        description: 'Update an existing place in a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            placeId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().min(1).max(200).optional(),
            description: zod_1.z.string().max(2000).optional(),
            lat: zod_1.z.number().optional(),
            lng: zod_1.z.number().optional(),
            address: zod_1.z.string().max(500).optional(),
            notes: zod_1.z.string().max(2000).optional(),
            website: zod_1.z.string().max(500).optional(),
            phone: zod_1.z.string().max(50).optional(),
        },
    }, async ({ tripId, placeId, name, description, lat, lng, address, notes, website, phone }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const existing = database_1.db.prepare('SELECT * FROM places WHERE id = ? AND trip_id = ?').get(placeId, tripId);
        if (!existing)
            return { content: [{ type: 'text', text: 'Place not found.' }], isError: true };
        database_1.db.prepare(`
        UPDATE places SET
          name = ?, description = ?, lat = ?, lng = ?, address = ?, notes = ?, website = ?, phone = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name ?? existing.name, description !== undefined ? description : existing.description, lat !== undefined ? lat : existing.lat, lng !== undefined ? lng : existing.lng, address !== undefined ? address : existing.address, notes !== undefined ? notes : existing.notes, website !== undefined ? website : existing.website, phone !== undefined ? phone : existing.phone, placeId);
        const place = database_1.db.prepare('SELECT * FROM places WHERE id = ?').get(placeId);
        (0, websocket_1.broadcast)(tripId, 'place:updated', { place });
        return ok({ place });
    });
    server.registerTool('delete_place', {
        description: 'Delete a place from a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            placeId: zod_1.z.number().int().positive(),
        },
    }, async ({ tripId, placeId }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const place = database_1.db.prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?').get(placeId, tripId);
        if (!place)
            return { content: [{ type: 'text', text: 'Place not found.' }], isError: true };
        database_1.db.prepare('DELETE FROM places WHERE id = ?').run(placeId);
        (0, websocket_1.broadcast)(tripId, 'place:deleted', { placeId });
        return ok({ success: true });
    });
    // --- ASSIGNMENTS ---
    server.registerTool('assign_place_to_day', {
        description: 'Assign a place to a specific day in a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            dayId: zod_1.z.number().int().positive(),
            placeId: zod_1.z.number().int().positive(),
            notes: zod_1.z.string().max(500).optional(),
        },
    }, async ({ tripId, dayId, placeId, notes }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const day = database_1.db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(dayId, tripId);
        if (!day)
            return { content: [{ type: 'text', text: 'Day not found.' }], isError: true };
        const place = database_1.db.prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?').get(placeId, tripId);
        if (!place)
            return { content: [{ type: 'text', text: 'Place not found.' }], isError: true };
        const maxOrder = database_1.db.prepare('SELECT MAX(order_index) as max FROM day_assignments WHERE day_id = ?').get(dayId);
        const orderIndex = (maxOrder.max !== null ? maxOrder.max : -1) + 1;
        const result = database_1.db.prepare('INSERT INTO day_assignments (day_id, place_id, order_index, notes) VALUES (?, ?, ?, ?)').run(dayId, placeId, orderIndex, notes || null);
        const assignment = database_1.db.prepare(`
        SELECT da.*, p.name as place_name, p.address, p.lat, p.lng
        FROM day_assignments da JOIN places p ON da.place_id = p.id
        WHERE da.id = ?
      `).get(result.lastInsertRowid);
        (0, websocket_1.broadcast)(tripId, 'assignment:created', { assignment });
        return ok({ assignment });
    });
    server.registerTool('unassign_place', {
        description: 'Remove a place assignment from a day.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            dayId: zod_1.z.number().int().positive(),
            assignmentId: zod_1.z.number().int().positive(),
        },
    }, async ({ tripId, dayId, assignmentId }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const assignment = database_1.db.prepare('SELECT da.id FROM day_assignments da JOIN days d ON da.day_id = d.id WHERE da.id = ? AND da.day_id = ? AND d.trip_id = ?').get(assignmentId, dayId, tripId);
        if (!assignment)
            return { content: [{ type: 'text', text: 'Assignment not found.' }], isError: true };
        database_1.db.prepare('DELETE FROM day_assignments WHERE id = ?').run(assignmentId);
        (0, websocket_1.broadcast)(tripId, 'assignment:deleted', { assignmentId, dayId });
        return ok({ success: true });
    });
    // --- BUDGET ---
    server.registerTool('create_budget_item', {
        description: 'Add a budget/expense item to a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().min(1).max(200),
            category: zod_1.z.string().max(100).optional().describe('Budget category (e.g. Accommodation, Food, Transport)'),
            total_price: zod_1.z.number().nonnegative(),
            note: zod_1.z.string().max(500).optional(),
        },
    }, async ({ tripId, name, category, total_price, note }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const maxOrder = database_1.db.prepare('SELECT MAX(sort_order) as max FROM budget_items WHERE trip_id = ?').get(tripId);
        const sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;
        const result = database_1.db.prepare('INSERT INTO budget_items (trip_id, category, name, total_price, note, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(tripId, category || 'Other', name, total_price, note || null, sortOrder);
        const item = database_1.db.prepare('SELECT * FROM budget_items WHERE id = ?').get(result.lastInsertRowid);
        (0, websocket_1.broadcast)(tripId, 'budget:created', { item });
        return ok({ item });
    });
    server.registerTool('delete_budget_item', {
        description: 'Delete a budget item from a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            itemId: zod_1.z.number().int().positive(),
        },
    }, async ({ tripId, itemId }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const item = database_1.db.prepare('SELECT id FROM budget_items WHERE id = ? AND trip_id = ?').get(itemId, tripId);
        if (!item)
            return { content: [{ type: 'text', text: 'Budget item not found.' }], isError: true };
        database_1.db.prepare('DELETE FROM budget_items WHERE id = ?').run(itemId);
        (0, websocket_1.broadcast)(tripId, 'budget:deleted', { itemId });
        return ok({ success: true });
    });
    // --- PACKING ---
    server.registerTool('create_packing_item', {
        description: 'Add an item to the packing checklist for a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().min(1).max(200),
            category: zod_1.z.string().max(100).optional().describe('Packing category (e.g. Clothes, Electronics)'),
        },
    }, async ({ tripId, name, category }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const maxOrder = database_1.db.prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?').get(tripId);
        const sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;
        const result = database_1.db.prepare('INSERT INTO packing_items (trip_id, name, checked, category, sort_order) VALUES (?, ?, ?, ?, ?)').run(tripId, name, 0, category || 'General', sortOrder);
        const item = database_1.db.prepare('SELECT * FROM packing_items WHERE id = ?').get(result.lastInsertRowid);
        (0, websocket_1.broadcast)(tripId, 'packing:created', { item });
        return ok({ item });
    });
    server.registerTool('toggle_packing_item', {
        description: 'Check or uncheck a packing item.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            itemId: zod_1.z.number().int().positive(),
            checked: zod_1.z.boolean(),
        },
    }, async ({ tripId, itemId, checked }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const item = database_1.db.prepare('SELECT id FROM packing_items WHERE id = ? AND trip_id = ?').get(itemId, tripId);
        if (!item)
            return { content: [{ type: 'text', text: 'Packing item not found.' }], isError: true };
        database_1.db.prepare('UPDATE packing_items SET checked = ? WHERE id = ?').run(checked ? 1 : 0, itemId);
        const updated = database_1.db.prepare('SELECT * FROM packing_items WHERE id = ?').get(itemId);
        (0, websocket_1.broadcast)(tripId, 'packing:updated', { item: updated });
        return ok({ item: updated });
    });
    server.registerTool('delete_packing_item', {
        description: 'Remove an item from the packing checklist.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            itemId: zod_1.z.number().int().positive(),
        },
    }, async ({ tripId, itemId }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const item = database_1.db.prepare('SELECT id FROM packing_items WHERE id = ? AND trip_id = ?').get(itemId, tripId);
        if (!item)
            return { content: [{ type: 'text', text: 'Packing item not found.' }], isError: true };
        database_1.db.prepare('DELETE FROM packing_items WHERE id = ?').run(itemId);
        (0, websocket_1.broadcast)(tripId, 'packing:deleted', { itemId });
        return ok({ success: true });
    });
    // --- RESERVATIONS ---
    server.registerTool('create_reservation', {
        description: 'Recommend a reservation for a trip. Created as pending — the user must confirm it. Linking: hotel → use place_id + start_day_id + end_day_id (all three required to create the accommodation link); restaurant/train/car/cruise/event/tour/activity/other → use assignment_id; flight → no linking.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            title: zod_1.z.string().min(1).max(200),
            type: zod_1.z.enum(['flight', 'hotel', 'restaurant', 'train', 'car', 'cruise', 'event', 'tour', 'activity', 'other']),
            reservation_time: zod_1.z.string().optional().describe('ISO 8601 datetime or time string'),
            location: zod_1.z.string().max(500).optional(),
            confirmation_number: zod_1.z.string().max(100).optional(),
            notes: zod_1.z.string().max(1000).optional(),
            day_id: zod_1.z.number().int().positive().optional(),
            place_id: zod_1.z.number().int().positive().optional().describe('Hotel place to link (hotel type only)'),
            start_day_id: zod_1.z.number().int().positive().optional().describe('Check-in day (hotel type only; requires place_id and end_day_id)'),
            end_day_id: zod_1.z.number().int().positive().optional().describe('Check-out day (hotel type only; requires place_id and start_day_id)'),
            assignment_id: zod_1.z.number().int().positive().optional().describe('Link to a day assignment (restaurant, train, car, cruise, event, tour, activity, other)'),
        },
    }, async ({ tripId, title, type, reservation_time, location, confirmation_number, notes, day_id, place_id, start_day_id, end_day_id, assignment_id }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        // Validate that all referenced IDs belong to this trip
        if (day_id) {
            if (!database_1.db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(day_id, tripId))
                return { content: [{ type: 'text', text: 'day_id does not belong to this trip.' }], isError: true };
        }
        if (place_id) {
            if (!database_1.db.prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?').get(place_id, tripId))
                return { content: [{ type: 'text', text: 'place_id does not belong to this trip.' }], isError: true };
        }
        if (start_day_id) {
            if (!database_1.db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(start_day_id, tripId))
                return { content: [{ type: 'text', text: 'start_day_id does not belong to this trip.' }], isError: true };
        }
        if (end_day_id) {
            if (!database_1.db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(end_day_id, tripId))
                return { content: [{ type: 'text', text: 'end_day_id does not belong to this trip.' }], isError: true };
        }
        if (assignment_id) {
            if (!database_1.db.prepare('SELECT da.id FROM day_assignments da JOIN days d ON da.day_id = d.id WHERE da.id = ? AND d.trip_id = ?').get(assignment_id, tripId))
                return { content: [{ type: 'text', text: 'assignment_id does not belong to this trip.' }], isError: true };
        }
        const reservation = database_1.db.transaction(() => {
            let accommodationId = null;
            if (type === 'hotel' && place_id && start_day_id && end_day_id) {
                const accResult = database_1.db.prepare('INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id, confirmation) VALUES (?, ?, ?, ?, ?)').run(tripId, place_id, start_day_id, end_day_id, confirmation_number || null);
                accommodationId = accResult.lastInsertRowid;
            }
            const result = database_1.db.prepare(`
          INSERT INTO reservations (trip_id, title, type, reservation_time, location, confirmation_number, notes, day_id, place_id, assignment_id, accommodation_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tripId, title, type, reservation_time || null, location || null, confirmation_number || null, notes || null, day_id || null, place_id || null, assignment_id || null, accommodationId, 'pending');
            return database_1.db.prepare('SELECT * FROM reservations WHERE id = ?').get(result.lastInsertRowid);
        })();
        if (type === 'hotel' && place_id && start_day_id && end_day_id) {
            (0, websocket_1.broadcast)(tripId, 'accommodation:created', {});
        }
        (0, websocket_1.broadcast)(tripId, 'reservation:created', { reservation });
        return ok({ reservation });
    });
    server.registerTool('delete_reservation', {
        description: 'Delete a reservation from a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            reservationId: zod_1.z.number().int().positive(),
        },
    }, async ({ tripId, reservationId }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const reservation = database_1.db.prepare('SELECT id, accommodation_id FROM reservations WHERE id = ? AND trip_id = ?').get(reservationId, tripId);
        if (!reservation)
            return { content: [{ type: 'text', text: 'Reservation not found.' }], isError: true };
        database_1.db.transaction(() => {
            if (reservation.accommodation_id) {
                database_1.db.prepare('DELETE FROM day_accommodations WHERE id = ?').run(reservation.accommodation_id);
            }
            database_1.db.prepare('DELETE FROM reservations WHERE id = ?').run(reservationId);
        })();
        if (reservation.accommodation_id) {
            (0, websocket_1.broadcast)(tripId, 'accommodation:deleted', { accommodationId: reservation.accommodation_id });
        }
        (0, websocket_1.broadcast)(tripId, 'reservation:deleted', { reservationId });
        return ok({ success: true });
    });
    server.registerTool('link_hotel_accommodation', {
        description: 'Set or update the check-in/check-out day links for a hotel reservation. Creates or updates the accommodation record that ties the reservation to a place and a date range. Use the day IDs from get_trip_summary.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            reservationId: zod_1.z.number().int().positive(),
            place_id: zod_1.z.number().int().positive().describe('The hotel place to link'),
            start_day_id: zod_1.z.number().int().positive().describe('Check-in day ID'),
            end_day_id: zod_1.z.number().int().positive().describe('Check-out day ID'),
        },
    }, async ({ tripId, reservationId, place_id, start_day_id, end_day_id }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const reservation = database_1.db.prepare('SELECT * FROM reservations WHERE id = ? AND trip_id = ?').get(reservationId, tripId);
        if (!reservation)
            return { content: [{ type: 'text', text: 'Reservation not found.' }], isError: true };
        if (reservation.type !== 'hotel')
            return { content: [{ type: 'text', text: 'Reservation is not of type hotel.' }], isError: true };
        if (!database_1.db.prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?').get(place_id, tripId))
            return { content: [{ type: 'text', text: 'place_id does not belong to this trip.' }], isError: true };
        if (!database_1.db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(start_day_id, tripId))
            return { content: [{ type: 'text', text: 'start_day_id does not belong to this trip.' }], isError: true };
        if (!database_1.db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(end_day_id, tripId))
            return { content: [{ type: 'text', text: 'end_day_id does not belong to this trip.' }], isError: true };
        let accommodationId = reservation.accommodation_id;
        const isNewAccommodation = !accommodationId;
        database_1.db.transaction(() => {
            if (accommodationId) {
                database_1.db.prepare('UPDATE day_accommodations SET place_id = ?, start_day_id = ?, end_day_id = ? WHERE id = ?')
                    .run(place_id, start_day_id, end_day_id, accommodationId);
            }
            else {
                const accResult = database_1.db.prepare('INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id, confirmation) VALUES (?, ?, ?, ?, ?)').run(tripId, place_id, start_day_id, end_day_id, reservation.confirmation_number || null);
                accommodationId = accResult.lastInsertRowid;
            }
            database_1.db.prepare('UPDATE reservations SET place_id = ?, accommodation_id = ? WHERE id = ?')
                .run(place_id, accommodationId, reservationId);
        })();
        (0, websocket_1.broadcast)(tripId, isNewAccommodation ? 'accommodation:created' : 'accommodation:updated', {});
        const updated = database_1.db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
        (0, websocket_1.broadcast)(tripId, 'reservation:updated', { reservation: updated });
        return ok({ reservation: updated, accommodation_id: accommodationId });
    });
    // --- DAYS ---
    server.registerTool('update_assignment_time', {
        description: 'Set the start and/or end time for a place assignment on a day (e.g. "09:00", "11:30"). Pass null to clear a time.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            assignmentId: zod_1.z.number().int().positive(),
            place_time: zod_1.z.string().max(50).nullable().optional().describe('Start time (e.g. "09:00"), or null to clear'),
            end_time: zod_1.z.string().max(50).nullable().optional().describe('End time (e.g. "11:00"), or null to clear'),
        },
    }, async ({ tripId, assignmentId, place_time, end_time }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const assignment = database_1.db.prepare(`
        SELECT da.* FROM day_assignments da
        JOIN days d ON da.day_id = d.id
        WHERE da.id = ? AND d.trip_id = ?
      `).get(assignmentId, tripId);
        if (!assignment)
            return { content: [{ type: 'text', text: 'Assignment not found.' }], isError: true };
        database_1.db.prepare('UPDATE day_assignments SET assignment_time = ?, assignment_end_time = ? WHERE id = ?')
            .run(place_time !== undefined ? place_time : assignment.assignment_time, end_time !== undefined ? end_time : assignment.assignment_end_time, assignmentId);
        const updated = database_1.db.prepare(`
        SELECT da.id, da.day_id, da.order_index, da.notes as assignment_notes,
          da.assignment_time, da.assignment_end_time,
          p.id as place_id, p.name, p.address
        FROM day_assignments da
        JOIN places p ON da.place_id = p.id
        WHERE da.id = ?
      `).get(assignmentId);
        (0, websocket_1.broadcast)(tripId, 'assignment:updated', { assignment: updated });
        return ok({ assignment: updated });
    });
    server.registerTool('update_day', {
        description: 'Set the title of a day in a trip (e.g. "Arrival in Paris", "Free day").',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            dayId: zod_1.z.number().int().positive(),
            title: zod_1.z.string().max(200).nullable().describe('Day title, or null to clear it'),
        },
    }, async ({ tripId, dayId, title }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const day = database_1.db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(dayId, tripId);
        if (!day)
            return { content: [{ type: 'text', text: 'Day not found.' }], isError: true };
        database_1.db.prepare('UPDATE days SET title = ? WHERE id = ?').run(title, dayId);
        const updated = database_1.db.prepare('SELECT * FROM days WHERE id = ?').get(dayId);
        (0, websocket_1.broadcast)(tripId, 'day:updated', { day: updated });
        return ok({ day: updated });
    });
    // --- RESERVATIONS (update) ---
    server.registerTool('update_reservation', {
        description: 'Update an existing reservation in a trip. Use status "confirmed" to confirm a pending recommendation, or "pending" to revert it. Linking: hotel → use place_id to link to an accommodation place; restaurant/train/car/cruise/event/tour/activity/other → use assignment_id to link to a day assignment; flight → no linking.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            reservationId: zod_1.z.number().int().positive(),
            title: zod_1.z.string().min(1).max(200).optional(),
            type: zod_1.z.enum(['flight', 'hotel', 'restaurant', 'train', 'car', 'cruise', 'event', 'tour', 'activity', 'other']).optional(),
            reservation_time: zod_1.z.string().optional().describe('ISO 8601 datetime or time string'),
            location: zod_1.z.string().max(500).optional(),
            confirmation_number: zod_1.z.string().max(100).optional(),
            notes: zod_1.z.string().max(1000).optional(),
            status: zod_1.z.enum(['pending', 'confirmed', 'cancelled']).optional(),
            place_id: zod_1.z.number().int().positive().nullable().optional().describe('Link to a place (use for hotel type), or null to unlink'),
            assignment_id: zod_1.z.number().int().positive().nullable().optional().describe('Link to a day assignment (use for restaurant, train, car, cruise, event, tour, activity, other), or null to unlink'),
        },
    }, async ({ tripId, reservationId, title, type, reservation_time, location, confirmation_number, notes, status, place_id, assignment_id }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const existing = database_1.db.prepare('SELECT * FROM reservations WHERE id = ? AND trip_id = ?').get(reservationId, tripId);
        if (!existing)
            return { content: [{ type: 'text', text: 'Reservation not found.' }], isError: true };
        if (place_id != null) {
            if (!database_1.db.prepare('SELECT id FROM places WHERE id = ? AND trip_id = ?').get(place_id, tripId))
                return { content: [{ type: 'text', text: 'place_id does not belong to this trip.' }], isError: true };
        }
        if (assignment_id != null) {
            if (!database_1.db.prepare('SELECT da.id FROM day_assignments da JOIN days d ON da.day_id = d.id WHERE da.id = ? AND d.trip_id = ?').get(assignment_id, tripId))
                return { content: [{ type: 'text', text: 'assignment_id does not belong to this trip.' }], isError: true };
        }
        database_1.db.prepare(`
        UPDATE reservations SET
          title = ?, type = ?, reservation_time = ?, location = ?,
          confirmation_number = ?, notes = ?, status = ?,
          place_id = ?, assignment_id = ?
        WHERE id = ?
      `).run(title ?? existing.title, type ?? existing.type, reservation_time !== undefined ? reservation_time : existing.reservation_time, location !== undefined ? location : existing.location, confirmation_number !== undefined ? confirmation_number : existing.confirmation_number, notes !== undefined ? notes : existing.notes, status ?? existing.status, place_id !== undefined ? place_id : existing.place_id, assignment_id !== undefined ? assignment_id : existing.assignment_id, reservationId);
        const updated = database_1.db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
        (0, websocket_1.broadcast)(tripId, 'reservation:updated', { reservation: updated });
        return ok({ reservation: updated });
    });
    // --- BUDGET (update) ---
    server.registerTool('update_budget_item', {
        description: 'Update an existing budget/expense item in a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            itemId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().min(1).max(200).optional(),
            category: zod_1.z.string().max(100).optional(),
            total_price: zod_1.z.number().nonnegative().optional(),
            persons: zod_1.z.number().int().positive().nullable().optional(),
            days: zod_1.z.number().int().positive().nullable().optional(),
            note: zod_1.z.string().max(500).nullable().optional(),
        },
    }, async ({ tripId, itemId, name, category, total_price, persons, days, note }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const existing = database_1.db.prepare('SELECT * FROM budget_items WHERE id = ? AND trip_id = ?').get(itemId, tripId);
        if (!existing)
            return { content: [{ type: 'text', text: 'Budget item not found.' }], isError: true };
        database_1.db.prepare(`
        UPDATE budget_items SET
          name = ?, category = ?, total_price = ?, persons = ?, days = ?, note = ?
        WHERE id = ?
      `).run(name ?? existing.name, category ?? existing.category, total_price !== undefined ? total_price : existing.total_price, persons !== undefined ? persons : existing.persons, days !== undefined ? days : existing.days, note !== undefined ? note : existing.note, itemId);
        const updated = database_1.db.prepare('SELECT * FROM budget_items WHERE id = ?').get(itemId);
        (0, websocket_1.broadcast)(tripId, 'budget:updated', { item: updated });
        return ok({ item: updated });
    });
    // --- PACKING (update) ---
    server.registerTool('update_packing_item', {
        description: 'Rename a packing item or change its category.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            itemId: zod_1.z.number().int().positive(),
            name: zod_1.z.string().min(1).max(200).optional(),
            category: zod_1.z.string().max(100).optional(),
        },
    }, async ({ tripId, itemId, name, category }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const existing = database_1.db.prepare('SELECT * FROM packing_items WHERE id = ? AND trip_id = ?').get(itemId, tripId);
        if (!existing)
            return { content: [{ type: 'text', text: 'Packing item not found.' }], isError: true };
        database_1.db.prepare('UPDATE packing_items SET name = ?, category = ? WHERE id = ?').run(name ?? existing.name, category ?? existing.category, itemId);
        const updated = database_1.db.prepare('SELECT * FROM packing_items WHERE id = ?').get(itemId);
        (0, websocket_1.broadcast)(tripId, 'packing:updated', { item: updated });
        return ok({ item: updated });
    });
    // --- REORDER ---
    server.registerTool('reorder_day_assignments', {
        description: 'Reorder places within a day by providing the assignment IDs in the desired order.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            dayId: zod_1.z.number().int().positive(),
            assignmentIds: zod_1.z.array(zod_1.z.number().int().positive()).min(1).max(200).describe('Assignment IDs in desired display order'),
        },
    }, async ({ tripId, dayId, assignmentIds }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const day = database_1.db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(dayId, tripId);
        if (!day)
            return { content: [{ type: 'text', text: 'Day not found.' }], isError: true };
        const update = database_1.db.prepare('UPDATE day_assignments SET order_index = ? WHERE id = ? AND day_id = ?');
        const updateMany = database_1.db.transaction((ids) => {
            ids.forEach((id, index) => update.run(index, id, dayId));
        });
        updateMany(assignmentIds);
        (0, websocket_1.broadcast)(tripId, 'assignment:reordered', { dayId, assignmentIds });
        return ok({ success: true, dayId, order: assignmentIds });
    });
    // --- TRIP SUMMARY ---
    server.registerTool('get_trip_summary', {
        description: 'Get a full denormalized summary of a trip in a single call: metadata, members, days with assignments and notes, accommodations, budget totals, packing stats, reservations, and collab notes. Use this as a context loader before planning or modifying a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
        },
    }, async ({ tripId }) => {
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const trip = database_1.db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
        if (!trip)
            return noAccess();
        // Members
        const owner = database_1.db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(trip.user_id);
        const members = database_1.db.prepare(`
        SELECT u.id, u.username, u.avatar, tm.added_at
        FROM trip_members tm JOIN users u ON tm.user_id = u.id
        WHERE tm.trip_id = ?
      `).all(tripId);
        // Days with assignments
        const days = database_1.db.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number ASC').all(tripId);
        const dayIds = days.map(d => d.id);
        const assignmentsByDay = {};
        if (dayIds.length > 0) {
            const placeholders = dayIds.map(() => '?').join(',');
            const assignments = database_1.db.prepare(`
          SELECT da.id, da.day_id, da.order_index, da.notes as assignment_notes,
            p.id as place_id, p.name, p.address, p.lat, p.lng,
            COALESCE(da.assignment_time, p.place_time) as place_time,
            c.name as category_name, c.icon as category_icon
          FROM day_assignments da
          JOIN places p ON da.place_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE da.day_id IN (${placeholders})
          ORDER BY da.order_index ASC
        `).all(...dayIds);
            for (const a of assignments) {
                if (!assignmentsByDay[a.day_id])
                    assignmentsByDay[a.day_id] = [];
                assignmentsByDay[a.day_id].push(a);
            }
        }
        // Day notes
        const dayNotesByDay = {};
        if (dayIds.length > 0) {
            const placeholders = dayIds.map(() => '?').join(',');
            const dayNotes = database_1.db.prepare(`
          SELECT * FROM day_notes WHERE day_id IN (${placeholders}) ORDER BY sort_order ASC
        `).all(...dayIds);
            for (const n of dayNotes) {
                if (!dayNotesByDay[n.day_id])
                    dayNotesByDay[n.day_id] = [];
                dayNotesByDay[n.day_id].push(n);
            }
        }
        const daysWithAssignments = days.map(d => ({
            ...d,
            assignments: assignmentsByDay[d.id] || [],
            notes: dayNotesByDay[d.id] || [],
        }));
        // Accommodations
        const accommodations = database_1.db.prepare(`
        SELECT da.*, p.name as place_name, ds.day_number as start_day_number, de.day_number as end_day_number
        FROM day_accommodations da
        JOIN places p ON da.place_id = p.id
        LEFT JOIN days ds ON da.start_day_id = ds.id
        LEFT JOIN days de ON da.end_day_id = de.id
        WHERE da.trip_id = ?
        ORDER BY ds.day_number ASC
      `).all(tripId);
        // Budget summary
        const budgetStats = database_1.db.prepare(`
        SELECT COUNT(*) as item_count, COALESCE(SUM(total_price), 0) as total
        FROM budget_items WHERE trip_id = ?
      `).get(tripId);
        // Packing summary
        const packingStats = database_1.db.prepare(`
        SELECT COUNT(*) as total, SUM(CASE WHEN checked = 1 THEN 1 ELSE 0 END) as checked
        FROM packing_items WHERE trip_id = ?
      `).get(tripId);
        // Upcoming reservations (all, sorted by time)
        const reservations = database_1.db.prepare(`
        SELECT r.*, d.day_number
        FROM reservations r
        LEFT JOIN days d ON r.day_id = d.id
        WHERE r.trip_id = ?
        ORDER BY r.reservation_time ASC, r.created_at ASC
      `).all(tripId);
        // Collab notes
        const collabNotes = database_1.db.prepare('SELECT * FROM collab_notes WHERE trip_id = ? ORDER BY pinned DESC, updated_at DESC').all(tripId);
        return ok({
            trip,
            members: { owner, collaborators: members },
            days: daysWithAssignments,
            accommodations,
            budget: { ...budgetStats, currency: trip.currency },
            packing: packingStats,
            reservations,
            collab_notes: collabNotes,
        });
    });
    // --- BUCKET LIST ---
    server.registerTool('create_bucket_list_item', {
        description: 'Add a destination to your personal travel bucket list.',
        inputSchema: {
            name: zod_1.z.string().min(1).max(200).describe('Destination or experience name'),
            lat: zod_1.z.number().optional(),
            lng: zod_1.z.number().optional(),
            country_code: zod_1.z.string().length(2).toUpperCase().optional().describe('ISO 3166-1 alpha-2 country code'),
            notes: zod_1.z.string().max(1000).optional(),
        },
    }, async ({ name, lat, lng, country_code, notes }) => {
        if (isDemoUser(userId))
            return demoDenied();
        const result = database_1.db.prepare('INSERT INTO bucket_list (user_id, name, lat, lng, country_code, notes) VALUES (?, ?, ?, ?, ?, ?)').run(userId, name, lat ?? null, lng ?? null, country_code || null, notes || null);
        const item = database_1.db.prepare('SELECT * FROM bucket_list WHERE id = ?').get(result.lastInsertRowid);
        return ok({ item });
    });
    server.registerTool('delete_bucket_list_item', {
        description: 'Remove an item from your travel bucket list.',
        inputSchema: {
            itemId: zod_1.z.number().int().positive(),
        },
    }, async ({ itemId }) => {
        if (isDemoUser(userId))
            return demoDenied();
        const item = database_1.db.prepare('SELECT id FROM bucket_list WHERE id = ? AND user_id = ?').get(itemId, userId);
        if (!item)
            return { content: [{ type: 'text', text: 'Bucket list item not found.' }], isError: true };
        database_1.db.prepare('DELETE FROM bucket_list WHERE id = ?').run(itemId);
        return ok({ success: true });
    });
    // --- ATLAS ---
    server.registerTool('mark_country_visited', {
        description: 'Mark a country as visited in your Atlas.',
        inputSchema: {
            country_code: zod_1.z.string().length(2).toUpperCase().describe('ISO 3166-1 alpha-2 country code (e.g. "FR", "JP")'),
        },
    }, async ({ country_code }) => {
        if (isDemoUser(userId))
            return demoDenied();
        database_1.db.prepare('INSERT OR IGNORE INTO visited_countries (user_id, country_code) VALUES (?, ?)').run(userId, country_code.toUpperCase());
        return ok({ success: true, country_code: country_code.toUpperCase() });
    });
    server.registerTool('unmark_country_visited', {
        description: 'Remove a country from your visited countries in Atlas.',
        inputSchema: {
            country_code: zod_1.z.string().length(2).toUpperCase().describe('ISO 3166-1 alpha-2 country code'),
        },
    }, async ({ country_code }) => {
        if (isDemoUser(userId))
            return demoDenied();
        database_1.db.prepare('DELETE FROM visited_countries WHERE user_id = ? AND country_code = ?').run(userId, country_code.toUpperCase());
        return ok({ success: true, country_code: country_code.toUpperCase() });
    });
    // --- COLLAB NOTES ---
    server.registerTool('create_collab_note', {
        description: 'Create a shared collaborative note on a trip (visible to all trip members in the Collab tab).',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            title: zod_1.z.string().min(1).max(200),
            content: zod_1.z.string().max(10000).optional(),
            category: zod_1.z.string().max(100).optional().describe('Note category (e.g. "Ideas", "To-do", "General")'),
            color: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Hex color for the note card'),
        },
    }, async ({ tripId, title, content, category, color }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const result = database_1.db.prepare(`
        INSERT INTO collab_notes (trip_id, user_id, title, content, category, color)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(tripId, userId, title, content || null, category || 'General', color || '#6366f1');
        const note = database_1.db.prepare('SELECT * FROM collab_notes WHERE id = ?').get(result.lastInsertRowid);
        (0, websocket_1.broadcast)(tripId, 'collab:note:created', { note });
        return ok({ note });
    });
    server.registerTool('update_collab_note', {
        description: 'Edit an existing collaborative note on a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            noteId: zod_1.z.number().int().positive(),
            title: zod_1.z.string().min(1).max(200).optional(),
            content: zod_1.z.string().max(10000).optional(),
            category: zod_1.z.string().max(100).optional(),
            color: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Hex color for the note card'),
            pinned: zod_1.z.boolean().optional().describe('Pin the note to the top'),
        },
    }, async ({ tripId, noteId, title, content, category, color, pinned }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const existing = database_1.db.prepare('SELECT * FROM collab_notes WHERE id = ? AND trip_id = ?').get(noteId, tripId);
        if (!existing)
            return { content: [{ type: 'text', text: 'Note not found.' }], isError: true };
        database_1.db.prepare(`
        UPDATE collab_notes SET
          title = CASE WHEN ? THEN ? ELSE title END,
          content = CASE WHEN ? THEN ? ELSE content END,
          category = CASE WHEN ? THEN ? ELSE category END,
          color = CASE WHEN ? THEN ? ELSE color END,
          pinned = CASE WHEN ? THEN ? ELSE pinned END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(title !== undefined ? 1 : 0, title !== undefined ? title : null, content !== undefined ? 1 : 0, content !== undefined ? content : null, category !== undefined ? 1 : 0, category !== undefined ? category : null, color !== undefined ? 1 : 0, color !== undefined ? color : null, pinned !== undefined ? 1 : 0, pinned !== undefined ? (pinned ? 1 : 0) : null, noteId);
        const note = database_1.db.prepare('SELECT * FROM collab_notes WHERE id = ?').get(noteId);
        (0, websocket_1.broadcast)(tripId, 'collab:note:updated', { note });
        return ok({ note });
    });
    server.registerTool('delete_collab_note', {
        description: 'Delete a collaborative note from a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            noteId: zod_1.z.number().int().positive(),
        },
    }, async ({ tripId, noteId }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const existing = database_1.db.prepare('SELECT id FROM collab_notes WHERE id = ? AND trip_id = ?').get(noteId, tripId);
        if (!existing)
            return { content: [{ type: 'text', text: 'Note not found.' }], isError: true };
        const noteFiles = database_1.db.prepare('SELECT filename FROM trip_files WHERE note_id = ?').all(noteId);
        const uploadsDir = path_1.default.resolve(__dirname, '../../uploads');
        for (const f of noteFiles) {
            const resolved = path_1.default.resolve(path_1.default.join(uploadsDir, 'files', f.filename));
            if (!resolved.startsWith(uploadsDir))
                continue;
            try {
                fs_1.default.unlinkSync(resolved);
            }
            catch { }
        }
        database_1.db.transaction(() => {
            database_1.db.prepare('DELETE FROM trip_files WHERE note_id = ?').run(noteId);
            database_1.db.prepare('DELETE FROM collab_notes WHERE id = ?').run(noteId);
        })();
        (0, websocket_1.broadcast)(tripId, 'collab:note:deleted', { noteId });
        return ok({ success: true });
    });
    // --- DAY NOTES ---
    server.registerTool('create_day_note', {
        description: 'Add a note to a specific day in a trip.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            dayId: zod_1.z.number().int().positive(),
            text: zod_1.z.string().min(1).max(500),
            time: zod_1.z.string().max(150).optional().describe('Time label (e.g. "09:00" or "Morning")'),
            icon: zod_1.z.string().optional().describe('Emoji icon for the note'),
        },
    }, async ({ tripId, dayId, text, time, icon }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const day = database_1.db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(dayId, tripId);
        if (!day)
            return { content: [{ type: 'text', text: 'Day not found.' }], isError: true };
        const result = database_1.db.prepare('INSERT INTO day_notes (day_id, trip_id, text, time, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(dayId, tripId, text.trim(), time || null, icon || '📝', 9999);
        const note = database_1.db.prepare('SELECT * FROM day_notes WHERE id = ?').get(result.lastInsertRowid);
        (0, websocket_1.broadcast)(tripId, 'dayNote:created', { dayId, note });
        return ok({ note });
    });
    server.registerTool('update_day_note', {
        description: 'Edit an existing note on a specific day.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            dayId: zod_1.z.number().int().positive(),
            noteId: zod_1.z.number().int().positive(),
            text: zod_1.z.string().min(1).max(500).optional(),
            time: zod_1.z.string().max(150).nullable().optional().describe('Time label (e.g. "09:00" or "Morning"), or null to clear'),
            icon: zod_1.z.string().optional().describe('Emoji icon for the note'),
        },
    }, async ({ tripId, dayId, noteId, text, time, icon }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const existing = database_1.db.prepare('SELECT * FROM day_notes WHERE id = ? AND day_id = ? AND trip_id = ?').get(noteId, dayId, tripId);
        if (!existing)
            return { content: [{ type: 'text', text: 'Note not found.' }], isError: true };
        database_1.db.prepare('UPDATE day_notes SET text = ?, time = ?, icon = ? WHERE id = ?').run(text !== undefined ? text.trim() : existing.text, time !== undefined ? time : existing.time, icon ?? existing.icon, noteId);
        const updated = database_1.db.prepare('SELECT * FROM day_notes WHERE id = ?').get(noteId);
        (0, websocket_1.broadcast)(tripId, 'dayNote:updated', { dayId, note: updated });
        return ok({ note: updated });
    });
    server.registerTool('delete_day_note', {
        description: 'Delete a note from a specific day.',
        inputSchema: {
            tripId: zod_1.z.number().int().positive(),
            dayId: zod_1.z.number().int().positive(),
            noteId: zod_1.z.number().int().positive(),
        },
    }, async ({ tripId, dayId, noteId }) => {
        if (isDemoUser(userId))
            return demoDenied();
        if (!(0, database_1.canAccessTrip)(tripId, userId))
            return noAccess();
        const note = database_1.db.prepare('SELECT id FROM day_notes WHERE id = ? AND day_id = ? AND trip_id = ?').get(noteId, dayId, tripId);
        if (!note)
            return { content: [{ type: 'text', text: 'Note not found.' }], isError: true };
        database_1.db.prepare('DELETE FROM day_notes WHERE id = ?').run(noteId);
        (0, websocket_1.broadcast)(tripId, 'dayNote:deleted', { noteId, dayId });
        return ok({ success: true });
    });
}
//# sourceMappingURL=tools.js.map