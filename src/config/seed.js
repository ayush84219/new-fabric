import { Room, Rack, Shelf, Supplier, Material, Grn, Issue, Transfer, AuditLog, User, sequelize } from '../models/index.js';
import bcrypt from 'bcryptjs';

export async function seedDatabase() {
  try {
    // Make sure the required user exists and has the correct password/status
    const hashedAyushPassword = await bcrypt.hash('Ayush123', 10);
    const [ayushUser, created] = await User.findOrCreate({
      where: { email: 'ay104061@gmail.com' },
      defaults: {
        name: 'Ayush',
        password: hashedAyushPassword,
        role: 'Admin',
        department: 'Management',
        status: 'Active',
        avatar: 'AY',
        isVerified: true
      }
    });

    if (!created) {
      ayushUser.password = hashedAyushPassword;
      ayushUser.isVerified = true;
      ayushUser.status = 'Active';
      ayushUser.role = 'Admin';
      await ayushUser.save();
      console.log('User "ay104061@gmail.com" password and verification status ensured.');
    } else {
      console.log('User "ay104061@gmail.com" created successfully.');
    }

    const roomCount = await Room.count();

    if (roomCount > 0) {
      console.log('Database already has rooms. Skipping seeding to prevent overwriting your database data.');
      return;
    }

    console.log('Database is empty. Seeding initial defaults...');

    // 1. Seed Rooms
    const roomsData = [
      { id: 'A', name: 'Hall 1', category: 'Summer Fabric', description: 'Lightweight summer fabrics', color: '#3b82f6', floor: '1st Floor' },
      { id: 'B', name: 'Hall 2', category: 'Winter Fabric', description: 'Heavy winter fabrics', color: '#8b5cf6', floor: '1st Floor' },
      { id: 'C', name: 'Hall 3', category: 'Accessories', description: 'Buttons, zippers, threads', color: '#f59e0b', floor: 'Ground Floor' },
    ];
    await Room.bulkCreate(roomsData, { ignoreDuplicates: true });

    // 2. Seed Racks (Zones)
    const racksData = [];
    ['A', 'B', 'C'].forEach(room => {
      ['A', 'B', 'C', 'D'].forEach((zone, idx) => {
        racksData.push({
          id: `${room}-${zone}`,
          room,
          number: idx + 1,
          name: `Zone ${zone}`
        });
      });
    });
    await Rack.bulkCreate(racksData, { ignoreDuplicates: true });

    // 3. Seed Shelves (Racks)
    const shelvesData = [];
    racksData.forEach(r => {
      const isZoneB = r.id.endsWith('-B');
      const count = isZoneB ? 15 : 9;
      for (let i = 1; i <= count; i++) {
        const shelfId = `${r.id}-R${i}`;
        let used = 0;
        const rand = Math.random();
        if (rand < 0.35) {
          used = 0; // Empty (Green)
        } else if (rand < 0.8) {
          used = Math.floor(Math.random() * 250) + 100; // Occupied (Blue)
        } else {
          used = 450 + Math.floor(Math.random() * 50); // Reserved/Full (Yellow)
        }

        shelvesData.push({
          id: shelfId,
          rack: r.id,
          room: r.room,
          number: i,
          name: `Rack R${i}`,
          capacity: 500,
          used
        });
      }
    });
    await Shelf.bulkCreate(shelvesData, { ignoreDuplicates: true });

    // 4. Seed Users
    const hashedPassword = await bcrypt.hash('password123', 10);
    const usersData = [
      { id: 1, name: 'Admin User', email: 'admin@textile.com', password: hashedPassword, role: 'Admin', department: 'Management', status: 'Active', avatar: 'AU', lastLogin: '2025-05-20 09:15', isVerified: true },
      { id: 2, name: 'Sara Ahmed', email: 'sara@textile.com', password: hashedPassword, role: 'Store Manager', department: 'Warehouse', status: 'Active', avatar: 'SA', lastLogin: '2025-05-20 08:30', isVerified: true },
      { id: 3, name: 'Ali Hassan', email: 'ali@textile.com', password: hashedPassword, role: 'Store Operator', department: 'Warehouse', status: 'Active', avatar: 'AH', lastLogin: '2025-05-19 17:00', isVerified: true },
      { id: 4, name: 'Fatima Khan', email: 'fatima@textile.com', password: hashedPassword, role: 'Store Operator', department: 'Production', status: 'Inactive', avatar: 'FK', lastLogin: '2025-05-10 11:00', isVerified: true },
      { id: 5, name: 'Ayush', email: 'ay104061@gmail.com', password: hashedAyushPassword, role: 'Admin', department: 'Management', status: 'Active', avatar: 'AY', lastLogin: '2025-05-20 09:15', isVerified: true },
    ];
    await User.bulkCreate(usersData, { ignoreDuplicates: true });

    // 5. Seed Suppliers
    const suppliersData = [
      { id: 1, name: 'Textron Fabrics Ltd', contact: 'Mohammad Raza', phone: '+92-300-1234567', email: 'mraza@textron.com', city: 'Karachi', country: 'Pakistan', category: 'Cotton Fabric', status: 'Active' },
      { id: 2, name: 'Global Textile Co.', contact: 'John Smith', phone: '+44-20-7946-0958', email: 'jsmith@global-textile.com', city: 'Manchester', country: 'UK', category: 'Polyester Fabric', status: 'Active' },
      { id: 3, name: 'Zara Accessories', contact: 'Li Wei', phone: '+86-21-5555-9876', email: 'lwei@zaraacc.cn', city: 'Shanghai', country: 'China', category: 'Accessories', status: 'Active' },
      { id: 4, name: 'Winter Weaves Inc.', contact: 'Sara Johnson', phone: '+1-555-234-5678', email: 'sara@winterweaves.com', city: 'New York', country: 'USA', category: 'Winter Fabric', status: 'Inactive' },
    ];
    await Supplier.bulkCreate(suppliersData, { ignoreDuplicates: true });

    // 6. Seed Materials
    const materialsData = [
      { id: 1, code: 'MAT00001', name: 'Cotton Fabric', category: 'Summer Fabric', subCategory: 'Plain Cotton', color: 'White', supplier: 1, weight: 250.00, rolls: 10, unit: 'Roll', location: 'A-A-R1', status: 'Active', stockKg: 250.00, billNumber: 'INV-8845', receivedPerson: 'Ali Hassan', authorizedPerson: 'Sara Ahmed', receivedDate: '2025-05-20' },
      { id: 2, code: 'MAT00002', name: 'Polyester Fabric', category: 'Summer Fabric', subCategory: 'Woven', color: 'Blue', supplier: 2, weight: 150.00, rolls: 6, unit: 'Roll', location: 'A-B-R2', status: 'Active', stockKg: 150.00, billNumber: 'INV-7654', receivedPerson: 'Ali Hassan', authorizedPerson: 'Paras Goyal', receivedDate: '2025-05-20' },
      { id: 3, code: 'MAT00003', name: 'Rib Fabric', category: 'Winter Fabric', subCategory: 'Rib Knit', color: 'Grey', supplier: 1, weight: 100.00, rolls: 4, unit: 'Roll', location: 'B-A-R1', status: 'Active', stockKg: 100.00, billNumber: 'INV-8846', receivedPerson: 'Sara Ahmed', authorizedPerson: 'Paras Goyal', receivedDate: '2025-05-20' },
      { id: 4, code: 'MAT00004', name: 'Lining Fabric', category: 'Summer Fabric', subCategory: 'Viscose Lining', color: 'Black', supplier: 2, weight: 80.00, rolls: 8, unit: 'Roll', location: 'A-A-R2', status: 'Low Stock', stockKg: 80.00, billNumber: 'INV-9921', receivedPerson: 'John Doe', authorizedPerson: 'Sarah Smith', receivedDate: '2025-05-19' },
      { id: 5, code: 'MAT00005', name: 'Buttons Pack', category: 'Accessories', subCategory: 'Plastic Buttons', color: 'Mixed', supplier: 3, weight: 5.00, rolls: 100, unit: 'Pcs', location: 'C-C-R1', status: 'Active', stockKg: 5.00, billNumber: 'INV-1102', receivedPerson: 'John Doe', authorizedPerson: 'Sarah Smith', receivedDate: '2025-05-18' },
      { id: 6, code: 'MAT00006', name: 'Denim Fabric', category: 'Winter Fabric', subCategory: 'Heavy Denim', color: 'Indigo', supplier: 4, weight: 320.00, rolls: 12, unit: 'Roll', location: 'B-B-R1', status: 'Active', stockKg: 320.00, billNumber: 'INV-2045', receivedPerson: 'Ali Hassan', authorizedPerson: 'Sara Ahmed', receivedDate: '2025-05-15' },
    ];
    await Material.bulkCreate(materialsData, { ignoreDuplicates: true });

    // 7. Seed GRNs
    const grnData = [
      { id: 1, grnNo: 'GRN-2025-001', supplier: 1, poNumber: 'PO-2025-0123', materialId: 1, weight: 250.00, rolls: 10, invoiceNo: 'INV-8845', receivedDate: '2025-05-20', receivedBy: 'Ali Hassan', status: 'Completed' },
      { id: 2, grnNo: 'GRN-2025-002', supplier: 2, poNumber: 'PO-2025-0124', materialId: 2, weight: 150.00, rolls: 6, invoiceNo: 'INV-7654', receivedDate: '2025-05-20', receivedBy: 'Ali Hassan', status: 'Completed' },
      { id: 3, grnNo: 'GRN-2025-003', supplier: 1, poNumber: 'PO-2025-0125', materialId: 3, weight: 100.00, rolls: 4, invoiceNo: 'INV-8846', receivedDate: '2025-05-20', receivedBy: 'Sara Ahmed', status: 'Completed' },
    ];
    await Grn.bulkCreate(grnData, { ignoreDuplicates: true });

    // 8. Seed Issues
    const issueData = [
      { id: 1, issueNo: 'ISS-2025-001', materialId: 2, rolls: 30, department: 'Cutting', issuedBy: 'Sara Ahmed', date: '2025-05-19', reason: 'Production Order #PO-456', status: 'Completed' },
      { id: 2, issueNo: 'ISS-2025-002', materialId: 4, rolls: 40, department: 'Sewing', issuedBy: 'Ali Hassan', date: '2025-05-19', reason: 'Lining for jackets', status: 'Completed' },
    ];
    await Issue.bulkCreate(issueData, { ignoreDuplicates: true });

    // 9. Seed Transfers
    const transferData = [
      { id: 1, transferNo: 'TRF-2025-001', materialId: 1, fromLocation: 'A-A-R3', toLocation: 'A-A-R1', rolls: 10, reason: 'Reorganization', date: '2025-05-18', transferredBy: 'Sara Ahmed', status: 'Completed' },
    ];
    await Transfer.bulkCreate(transferData, { ignoreDuplicates: true });

    // 10. Seed Audit Logs
    const auditData = [
      { id: 1, action: 'Material Received', detail: 'GRN-2025-001: Cotton Fabric 250Kg received', user: 'Ali Hassan', date: '2025-05-20 09:30', type: 'receive' },
      { id: 2, action: 'Material Issued', detail: 'ISS-2025-001: Polyester 30Kg issued to Cutting', user: 'Sara Ahmed', date: '2025-05-19 14:20', type: 'issue' },
      { id: 3, action: 'Material Transfer', detail: 'TRF-2025-001: Cotton Fabric moved A01→A03', user: 'Sara Ahmed', date: '2025-05-18 11:00', type: 'transfer' },
      { id: 4, action: 'User Login', detail: 'Admin User logged in', user: 'Admin User', date: '2025-05-20 09:00', type: 'auth' },
    ];
    await AuditLog.bulkCreate(auditData, { ignoreDuplicates: true });

    console.log('Database seeding completed successfully.');
  } catch (error) {
    console.error('Seeding database failed:', error);
  }
}
