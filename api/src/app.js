import express from 'express'
import cors from "cors";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import {PrismaClient} from "@prisma/client";
import jwt from 'jsonwebtoken';
import { authenticateToken } from './middleware/auth.js'

const app = express();
app.use(cors())
app.use(bodyParser.json());
const prisma = new PrismaClient();
const PORT = 3200;

app.get('/', (req, res) => {
    res.send('Started Working, Express!');
});

app.post('/api/login', async (request, response) => {
    const { email, password } = request.body
    try {
        const user = await prisma.user.findFirst({
            where: { email }
        })

        if(!user) return response.status(422).send({ error: 'Email or password is invalid' });

        bcrypt.compare(password, user.password, (err, res) => {
            if(err) return response.status(422).send({ error: 'Email or password is invalid' });

            if(res) {
                const token = jwt.sign({ userId : user.id }, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '1h'});
                return response.send({token});
            }
            else
                return response.status(401).send({ error: "Invalid credential" })
        });

    } catch (error) {
        return response.status(400).send({ error: 'Email or password is invalid' })
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body

        if (!firstName.length || !lastName.length || !email.length || !password.length)
            return res.status(400).send({ error: 'The payload is missing' })

        // Hash the password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create a new user into the database
        const newUser = await prisma.user.create({
            data: {
                first_name: firstName,
                last_name: lastName,
                email,
                password: passwordHash,
            },
        });

        res.status(201).json({ user: newUser });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
})

app.post('/api/guests', authenticateToken, async (req, res) => {
    try {
        const { name, guestsCount, side, closeness } = req.body

        if (!name.length || !guestsCount || !side.length || !closeness.length)
            return res.status(400).send({ error: 'The payload is missing' })

        // Create a new guest into the database
        const newGuest = await prisma.guest.create({
            data: {
                name,
                count: guestsCount,
                side,
                closeness,
                user_id: req.user.id
            },
        });

        res.status(201).json(newGuest);
    } catch (error) {
        console.error('Error creating a guest:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
})

app.get('/api/guests', authenticateToken, async (req, res) => {
    try {
        const guests = await prisma.guest.findMany({
            where: {
                user_id: req.user.id
            },
            include: {
                table: true,
            },
        });
        res.status(200).json(guests);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
})

app.post('/api/tables/save', authenticateToken, async (req, res) => {
    try {
        const tables = req.body.tables;
        await prisma.guest.updateMany({
            where: {
                table_id: {
                    not: null
                },
                user_id: req.user.id
            },
            data: {
                table_id: null
            }
        });

        for (let table of tables) {
            for (let guest of table.guests) {
                await prisma.guest.update({
                    where: { id: guest.id },
                    data: { table_id: table.table.id }
                });
            }
        }

        res.status(200).send('Seating arrangement saved successfully.');
    } catch (error) {
        console.log('Error saving seating arrangement:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.put('/api/guests/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const {name, guestCount} = req.body;

        const dataToUpdate = {}
        if (name!==null)
            dataToUpdate.name = name
        if (guestCount!==null)
            dataToUpdate.count = parseInt(guestCount)

        const updatedGuest = await prisma.guest.update({
            where: { id: parseInt(id) },
            data: dataToUpdate,
        });

        res.status(200).json(updatedGuest);
    } catch (error) {
        console.log('Error during guest update:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/tables', authenticateToken, async (req, res) => {
    try {
        const { tableNumber, placesCount } = req.body
        if (!tableNumber || !placesCount)
            return res.status(400).send({ error: 'The payload is missing' })
        console.log( " req.user.id", req.user.id)
        const tableDoesExist = await prisma.table.findMany({
            where: {
                table_number: tableNumber,
                user_id: req.user.id
            },
        })
        console.log(tableDoesExist)
        if (tableDoesExist.length)
            return res.status(422).send({ error: 'The number table already exist'})

        const newTable = await prisma.table.create({
            data: {
                table_number: parseInt(tableNumber),
                places_count: placesCount,
                user_id: req.user.id
            },
        });

        res.status(201).json(newTable);
    } catch (error) {
        console.error('Error creating a guest:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
})

app.get('/api/tables', authenticateToken, async (req, res) => {
    try {
        const tables = await prisma.table.findMany({
            where: {
                user_id: req.user.id
            }
        });
        res.status(200).json(tables);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
})

app.post('/api/tables/generate', authenticateToken, async (req, res) => {
    try {
        const guestsByUser = await prisma.guest.findMany({
            select: {
                side: true,
                closeness: true,
                count: true,
                name: true,
                id: true,
                table_id: true
            },
            where: {
                user_id: req.user.id
            },
        });

        // Group guests by side and closeness
        const groupedGuests = guestsByUser.reduce((acc, guest) => {
            const key = `${guest.side}-${guest.closeness}`;
            if (!acc[key]) {
                acc[key] = { side: guest.side, closeness: guest.closeness, guestsCount: 0, guests: [] };
            }
            acc[key].guestsCount += guest.count;
            acc[key].guests.push(guest);
            return acc;
        }, {});

        // Sort groups by number of guests (largest first)
        let sortedGuests = Object.values(groupedGuests).sort((a, b) => b.guestsCount - a.guestsCount);

        // Retrieve the tables
        const tables = await prisma.table.findMany({
            where: { user_id: req.user.id },
            orderBy: { places_count: 'desc' }
        });

        const seatingPlan = [];
        let remainingGuests = [];

        for (let table of tables) {
            let remainingSeats = table.places_count;

            // While there are guests left to seat and the table still has seats
            while (remainingSeats > 0 && sortedGuests.length > 0) {
                let currentGroup = sortedGuests[0];

                if (remainingSeats >= currentGroup.guestsCount) {
                    // Seat the entire group at this table
                    seatingPlan.push({
                        table: table,
                        guests: currentGroup.guests,
                        guestsCount: currentGroup.guestsCount
                    });

                    await Promise.all(currentGroup.guests.map(guest =>
                        prisma.guest.update({
                            where: { id: guest.id },
                            data: { table_id: table.id }
                        })
                    ));

                    // Remove this group as they are fully seated
                    sortedGuests.shift();
                    remainingSeats -= currentGroup.guestsCount;
                } else {
                    // Split the group and seat only what fits
                    let guestsToSeat = currentGroup.guests.splice(0, remainingSeats);
                    seatingPlan.push({
                        table: table,
                        guests: guestsToSeat,
                        guestsCount: guestsToSeat.reduce((acc, g) => acc + g.count, 0)
                    });

                    await Promise.all(guestsToSeat.map(guest =>
                        prisma.guest.update({
                            where: { id: guest.id },
                            data: { table_id: table.id }
                        })
                    ));

                    remainingSeats -= guestsToSeat.reduce((acc, g) => acc + g.count, 0);

                    // The remainder of this group needs to be seated later
                    currentGroup.guestsCount = currentGroup.guests.reduce((acc, g) => acc + g.count, 0);

                    // Move to the next table for the remaining guests
                }
            }

            // If the table is full and there are still unseated guests in the current group
            if (sortedGuests.length > 0 && remainingSeats === 0) {
                remainingGuests.push(sortedGuests.shift());
            }
        }

        // Handle remaining unseated guests by filling up other tables
        while (remainingGuests.length > 0 && tables.length > 0) {
            let table = tables.shift();
            let remainingSeats = table.places_count;

            while (remainingSeats > 0 && remainingGuests.length > 0) {
                let currentGroup = remainingGuests[0];

                if (remainingSeats >= currentGroup.guestsCount) {
                    // Seat the entire group
                    seatingPlan.push({
                        table: table,
                        guests: currentGroup.guests,
                        guestsCount: currentGroup.guestsCount
                    });

                    await Promise.all(currentGroup.guests.map(guest =>
                        prisma.guest.update({
                            where: { id: guest.id },
                            data: { table_id: table.id }
                        })
                    ));

                    remainingSeats -= currentGroup.guestsCount;
                    remainingGuests.shift();
                } else {
                    // Seat part of the group
                    let guestsToSeat = currentGroup.guests.splice(0, remainingSeats);
                    seatingPlan.push({
                        table: table,
                        guests: guestsToSeat,
                        guestsCount: guestsToSeat.reduce((acc, g) => acc + g.count, 0)
                    });

                    await Promise.all(guestsToSeat.map(guest =>
                        prisma.guest.update({
                            where: { id: guest.id },
                            data: { table_id: table.id }
                        })
                    ));

                    remainingSeats -= guestsToSeat.reduce((acc, g) => acc + g.count, 0);

                    currentGroup.guestsCount = currentGroup.guests.reduce((acc, g) => acc + g.count, 0);
                }
            }
        }

        res.status(201).json(seatingPlan);
    } catch (error) {
        console.error('Error generating tables:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.delete('/api/guests/:id', authenticateToken, async (req, res) => {
    try {
        const {id} = req.params
        await prisma.guest.delete({
            where: { id: parseInt(id) },
        });
        res.status(200).json();
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
})

app.listen(PORT, () => {
    console.log(`Server listening at port: ${PORT}`);
});