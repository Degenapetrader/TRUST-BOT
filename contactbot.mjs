import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

// Constants
const CONTACTS_DB_FILE = 'Contacts.json';

// Contact Management Bot
class ContactBot {
  constructor() {
    this.contactsFile = CONTACTS_DB_FILE;
    this.ensureContactsFile();
  }

  // Ensure contacts file exists
  ensureContactsFile() {
    if (!fs.existsSync(this.contactsFile)) {
      const initialData = {
        lastUpdated: new Date().toISOString(),
        contacts: {}
      };
      fs.writeFileSync(this.contactsFile, JSON.stringify(initialData, null, 2));
      console.log(`📁 Created new contacts database: ${this.contactsFile}`);
    }
  }

  // Load contacts from file
  loadContacts() {
    try {
      const data = fs.readFileSync(this.contactsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`❌ Error loading contacts: ${error.message}`);
      return { contacts: {} };
    }
  }

  // Save contacts to file
  saveContacts(contactsData) {
    try {
      contactsData.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.contactsFile, JSON.stringify(contactsData, null, 2));
      return true;
    } catch (error) {
      console.error(`❌ Error saving contacts: ${error.message}`);
      return false;
    }
  }

  // Validate Ethereum address
  isValidAddress(address) {
    try {
      return ethers.isAddress(address);
    } catch (error) {
      return false;
    }
  }

  // Validate contact label
  isValidLabel(label) {
    // Label should be alphanumeric with optional underscores/hyphens
    const labelRegex = /^[a-zA-Z0-9_-]+$/;
    return labelRegex.test(label) && label.length >= 1 && label.length <= 50;
  }

  // Add new contact
  addContact(label, address, description = '') {
    console.log(`\n👤 Adding Contact: ${label}`);
    console.log(`📍 Address: ${address}`);
    
    // Validate inputs
    if (!this.isValidLabel(label)) {
      console.error(`❌ Invalid label: ${label}`);
      console.error(`   Labels must be alphanumeric (with _ or -) and 1-50 characters`);
      return false;
    }

    if (!this.isValidAddress(address)) {
      console.error(`❌ Invalid Ethereum address: ${address}`);
      return false;
    }

    // Normalize address
    const normalizedAddress = ethers.getAddress(address);
    
    // Load existing contacts
    const contactsData = this.loadContacts();
    
    // Check if label already exists
    if (contactsData.contacts[label]) {
      console.error(`❌ Contact label "${label}" already exists!`);
      console.log(`   Existing address: ${contactsData.contacts[label].address}`);
      console.log(`   Use 'update' command to modify or choose a different label`);
      return false;
    }

    // Check if address already exists with different label
    const existingLabel = Object.keys(contactsData.contacts).find(
      key => contactsData.contacts[key].address.toLowerCase() === normalizedAddress.toLowerCase()
    );
    
    if (existingLabel) {
      console.log(`⚠️  Address already exists with label: ${existingLabel}`);
      console.log(`   You can still add with new label if desired...`);
    }

    // Add new contact
    contactsData.contacts[label] = {
      address: normalizedAddress,
      description: description || '',
      addedAt: new Date().toISOString(),
      lastUsed: null,
      usageCount: 0
    };

    // Save to file
    if (this.saveContacts(contactsData)) {
      console.log(`✅ Contact "${label}" added successfully!`);
      console.log(`📱 Address: ${normalizedAddress}`);
      if (description) {
        console.log(`📝 Description: ${description}`);
      }
      return true;
    } else {
      console.error(`❌ Failed to save contact`);
      return false;
    }
  }

  // List all contacts
  listContacts(search = '') {
    console.log(`\n📞 CONTACT LIST`);
    console.log(`===============`);
    
    const contactsData = this.loadContacts();
    const contacts = contactsData.contacts;
    
    if (Object.keys(contacts).length === 0) {
      console.log(`📭 No contacts found. Add some with: npm run contactbot add <label> <address>`);
      return;
    }

    // Filter contacts if search term provided
    const filteredContacts = Object.entries(contacts).filter(([label, contact]) => {
      if (!search) return true;
      
      const searchLower = search.toLowerCase();
      return (
        label.toLowerCase().includes(searchLower) ||
        contact.address.toLowerCase().includes(searchLower) ||
        (contact.description && contact.description.toLowerCase().includes(searchLower))
      );
    });

    if (filteredContacts.length === 0) {
      console.log(`🔍 No contacts found matching: "${search}"`);
      return;
    }

    console.log(`📊 Found ${filteredContacts.length} contact(s):`);
    console.log('');

    filteredContacts.forEach(([label, contact], index) => {
      console.log(`${index + 1}. 🏷️  ${label}`);
      console.log(`   📍 ${contact.address}`);
      if (contact.description) {
        console.log(`   📝 ${contact.description}`);
      }
      console.log(`   📅 Added: ${new Date(contact.addedAt).toLocaleDateString()}`);
      console.log(`   📊 Used: ${contact.usageCount} times`);
      if (contact.lastUsed) {
        console.log(`   🕐 Last used: ${new Date(contact.lastUsed).toLocaleDateString()}`);
      }
      console.log('');
    });

    console.log(`📞 Total contacts in database: ${Object.keys(contacts).length}`);
    if (contactsData.lastUpdated) {
      console.log(`🕐 Database last updated: ${new Date(contactsData.lastUpdated).toLocaleString()}`);
    }
  }

  // Remove contact
  removeContact(label) {
    console.log(`\n🗑️  Removing Contact: ${label}`);
    
    const contactsData = this.loadContacts();
    
    if (!contactsData.contacts[label]) {
      console.error(`❌ Contact "${label}" not found!`);
      console.log(`   Use 'list' command to see available contacts`);
      return false;
    }

    const contactToRemove = contactsData.contacts[label];
    console.log(`📍 Address: ${contactToRemove.address}`);
    
    // Remove contact
    delete contactsData.contacts[label];
    
    // Save to file
    if (this.saveContacts(contactsData)) {
      console.log(`✅ Contact "${label}" removed successfully!`);
      return true;
    } else {
      console.error(`❌ Failed to remove contact`);
      return false;
    }
  }

  // Update contact
  updateContact(label, newAddress = null, newDescription = null) {
    console.log(`\n✏️  Updating Contact: ${label}`);
    
    const contactsData = this.loadContacts();
    
    if (!contactsData.contacts[label]) {
      console.error(`❌ Contact "${label}" not found!`);
      console.log(`   Use 'list' command to see available contacts`);
      return false;
    }

    const contact = contactsData.contacts[label];
    
    // Update address if provided
    if (newAddress) {
      if (!this.isValidAddress(newAddress)) {
        console.error(`❌ Invalid Ethereum address: ${newAddress}`);
        return false;
      }
      const oldAddress = contact.address;
      contact.address = ethers.getAddress(newAddress);
      console.log(`📍 Address updated: ${oldAddress} → ${contact.address}`);
    }

    // Update description if provided
    if (newDescription !== null) {
      const oldDescription = contact.description;
      contact.description = newDescription;
      console.log(`📝 Description updated: "${oldDescription}" → "${newDescription}"`);
    }

    // Save to file
    if (this.saveContacts(contactsData)) {
      console.log(`✅ Contact "${label}" updated successfully!`);
      return true;
    } else {
      console.error(`❌ Failed to update contact`);
      return false;
    }
  }

  // Get contact by label
  getContact(label) {
    const contactsData = this.loadContacts();
    return contactsData.contacts[label] || null;
  }

  // Search contacts by various criteria
  searchContacts(query) {
    console.log(`\n🔍 SEARCHING CONTACTS: "${query}"`);
    console.log(`================================`);
    
    const contactsData = this.loadContacts();
    const contacts = contactsData.contacts;
    
    if (Object.keys(contacts).length === 0) {
      console.log(`📭 No contacts in database to search`);
      return;
    }

    const results = [];
    const queryLower = query.toLowerCase();

    Object.entries(contacts).forEach(([label, contact]) => {
      let score = 0;
      let matches = [];

      // Exact label match (highest score)
      if (label.toLowerCase() === queryLower) {
        score += 100;
        matches.push('exact label match');
      }
      // Partial label match
      else if (label.toLowerCase().includes(queryLower)) {
        score += 50;
        matches.push('label contains query');
      }

      // Address match (partial)
      if (contact.address.toLowerCase().includes(queryLower)) {
        score += 30;
        matches.push('address contains query');
      }

      // Description match
      if (contact.description && contact.description.toLowerCase().includes(queryLower)) {
        score += 20;
        matches.push('description contains query');
      }

      if (score > 0) {
        results.push({
          label,
          contact,
          score,
          matches
        });
      }
    });

    // Sort by score (highest first)
    results.sort((a, b) => b.score - a.score);

    if (results.length === 0) {
      console.log(`❌ No contacts found matching: "${query}"`);
      console.log(`   Try searching by label, address, or description keywords`);
      return;
    }

    console.log(`📊 Found ${results.length} matching contact(s):`);
    console.log('');

    results.forEach((result, index) => {
      console.log(`${index + 1}. 🏷️  ${result.label} (Score: ${result.score})`);
      console.log(`   📍 ${result.contact.address}`);
      if (result.contact.description) {
        console.log(`   📝 ${result.contact.description}`);
      }
      console.log(`   🎯 Matches: ${result.matches.join(', ')}`);
      console.log(`   📊 Used: ${result.contact.usageCount} times`);
      console.log('');
    });
  }

  // Export contacts to different formats
  exportContacts(format = 'json') {
    console.log(`\n📤 EXPORTING CONTACTS (${format.toUpperCase()})`);
    console.log(`=============================`);
    
    const contactsData = this.loadContacts();
    const contacts = contactsData.contacts;
    
    if (Object.keys(contacts).length === 0) {
      console.log(`📭 No contacts to export`);
      return false;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    try {
      if (format.toLowerCase() === 'csv') {
        // Export as CSV
        const csvHeader = 'Label,Address,Description,Added At,Usage Count,Last Used\n';
        const csvRows = Object.entries(contacts).map(([label, contact]) => {
          return `"${label}","${contact.address}","${contact.description || ''}","${contact.addedAt}","${contact.usageCount}","${contact.lastUsed || ''}"`;
        }).join('\n');
        
        const csvContent = csvHeader + csvRows;
        const csvFilename = `contacts-export-${timestamp}.csv`;
        
        fs.writeFileSync(csvFilename, csvContent);
        console.log(`✅ Contacts exported to: ${csvFilename}`);
        console.log(`📊 Exported ${Object.keys(contacts).length} contacts`);
        
      } else {
        // Export as JSON (default)
        const exportData = {
          exportedAt: new Date().toISOString(),
          totalContacts: Object.keys(contacts).length,
          originalFile: this.contactsFile,
          ...contactsData
        };
        
        const jsonFilename = `contacts-export-${timestamp}.json`;
        fs.writeFileSync(jsonFilename, JSON.stringify(exportData, null, 2));
        console.log(`✅ Contacts exported to: ${jsonFilename}`);
        console.log(`📊 Exported ${Object.keys(contacts).length} contacts`);
      }
      
      return true;
    } catch (error) {
      console.error(`❌ Export failed: ${error.message}`);
      return false;
    }
  }

  // Show usage help
  showUsage() {
    console.log('👤 CONTACT BOT - Address Book Management');
    console.log('==========================================');
    console.log('');
    console.log('📋 COMMANDS:');
    console.log('  contactbot add <label> <address> [description]     - Add new contact');
    console.log('  contactbot list [search_term]                      - List all contacts (with optional search)');
    console.log('  contactbot remove <label>                          - Remove contact');
    console.log('  contactbot update <label> [address] [description]  - Update contact');
    console.log('  contactbot search <query>                          - Search contacts');
    console.log('  contactbot export [format]                         - Export contacts (json/csv)');
    console.log('  contactbot info <label>                            - Show detailed contact info');
    console.log('');
    console.log('📝 EXAMPLES:');
    console.log('  contactbot add alice 0x1234...abcd "Main trading wallet"');
    console.log('  contactbot add bob 0x5678...efgh');
    console.log('  contactbot list');
    console.log('  contactbot list alice');
    console.log('  contactbot remove alice');
    console.log('  contactbot search 0x1234');
    console.log('  contactbot export csv');
    console.log('  contactbot info alice');
    console.log('');
    console.log('⚙️  FEATURES:');
    console.log('  ✅ Address validation and checksumming');
    console.log('  ✅ Duplicate detection');
    console.log('  ✅ Usage tracking (count and last used)');
    console.log('  ✅ Search by label, address, or description');
    console.log('  ✅ Export to JSON or CSV formats');
    console.log('  ✅ Persistent storage in Contacts.json');
    console.log('');
    console.log('📁 Database file: ' + this.contactsFile);
  }

  // Get contact info
  getContactInfo(label) {
    console.log(`\n📱 CONTACT INFO: ${label}`);
    console.log(`====================`);
    
    const contact = this.getContact(label);
    
    if (!contact) {
      console.error(`❌ Contact "${label}" not found!`);
      console.log(`   Use 'list' command to see available contacts`);
      return false;
    }

    console.log(`🏷️  Label: ${label}`);
    console.log(`📍 Address: ${contact.address}`);
    console.log(`📝 Description: ${contact.description || '(none)'}`);
    console.log(`📅 Added: ${new Date(contact.addedAt).toLocaleString()}`);
    console.log(`📊 Usage Count: ${contact.usageCount}`);
    
    if (contact.lastUsed) {
      console.log(`🕐 Last Used: ${new Date(contact.lastUsed).toLocaleString()}`);
    } else {
      console.log(`🕐 Last Used: Never`);
    }

    // Additional address info
    console.log('');
    console.log('🔍 Address Details:');
    console.log(`   📋 Checksum: ${contact.address}`);
    console.log(`   📋 Lowercase: ${contact.address.toLowerCase()}`);
    console.log(`   📏 Length: 42 characters (including 0x)`);

    return true;
  }
}

// Main function to handle command line arguments
async function main() {
  const args = process.argv.slice(2);
  const contactBot = new ContactBot();
  
  if (args.length === 0) {
    contactBot.showUsage();
    return;
  }

  const command = args[0].toLowerCase();
  
  try {
    switch (command) {
      case 'add':
        if (args.length < 3) {
          console.error('❌ Usage: contactbot add <label> <address> [description]');
          return;
        }
        const description = args.slice(3).join(' ');
        contactBot.addContact(args[1], args[2], description);
        break;

      case 'list':
        const searchTerm = args[1] || '';
        contactBot.listContacts(searchTerm);
        break;

      case 'remove':
      case 'delete':
        if (args.length < 2) {
          console.error('❌ Usage: contactbot remove <label>');
          return;
        }
        contactBot.removeContact(args[1]);
        break;

      case 'update':
        if (args.length < 2) {
          console.error('❌ Usage: contactbot update <label> [address] [description]');
          return;
        }
        const newAddress = args[2] || null;
        const newDesc = args.slice(3).join(' ') || null;
        contactBot.updateContact(args[1], newAddress, newDesc);
        break;

      case 'search':
        if (args.length < 2) {
          console.error('❌ Usage: contactbot search <query>');
          return;
        }
        contactBot.searchContacts(args.slice(1).join(' '));
        break;

      case 'export':
        const format = args[1] || 'json';
        contactBot.exportContacts(format);
        break;

      case 'info':
        if (args.length < 2) {
          console.error('❌ Usage: contactbot info <label>');
          return;
        }
        contactBot.getContactInfo(args[1]);
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        contactBot.showUsage();
        break;
    }
  } catch (error) {
    console.error(`❌ Contact Bot error: ${error.message}`);
  }
}

// Only run main if this file is executed directly
if (process.argv[1].endsWith('contactbot.mjs')) {
    main();
} 